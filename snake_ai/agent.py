"""The learner: a Deep Q-Network (DQN) agent.

Three ideas, each a few lines:

1. Epsilon-greedy: with probability epsilon pick a random move (explore),
   otherwise the move with the highest Q-value (exploit).
2. Replay memory: store every step as (state, action, reward, next_state,
   terminal) and train on random batches of old steps, not just the last one.
3. Target network: a frozen copy of the network that computes the targets
   y = r + gamma * max Q_target(s', a'). It is refreshed every few hundred
   updates, so the thing we chase does not move every time we take a step.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .game import N_ACTIONS, STATE_SIZE
from .network import SGD, Adam, QNetwork, q_loss


@dataclass
class Config:
    """Every knob of a training run. The defaults are the ones used for the main model."""

    hidden: int = 64             # units in the hidden layer
    lr: float = 1e-3             # learning rate
    optimizer: str = "adam"      # "adam" or "sgd"
    gamma: float = 0.9           # discount: how much the future counts
    batch_size: int = 64         # transitions per update
    memory: int = 100_000        # replay memory capacity
    learn_start: int = 1_000     # steps collected before the first update
    target_sync: int = 500       # updates between target-network refreshes; 0 = no target network
    eps_start: float = 1.0       # epsilon in game 1
    eps_end: float = 0.01        # epsilon floor
    eps_decay_games: int = 150   # games to go from eps_start to eps_end
    board: int = 20              # board is board x board cells

    def to_dict(self) -> dict:
        return asdict(self)


def epsilon_for_game(game: int, cfg: Config) -> float:
    """Linear decay from eps_start to eps_end over eps_decay_games, then flat."""
    if cfg.eps_decay_games <= 0:
        return cfg.eps_end
    frac = min(1.0, game / cfg.eps_decay_games)
    return cfg.eps_start + frac * (cfg.eps_end - cfg.eps_start)


class ReplayMemory:
    """A fixed-size ring buffer of transitions, stored as NumPy arrays.

    When it is full, the oldest transition is overwritten. ``sample`` draws a
    random batch, which breaks up the strong correlation between consecutive
    steps of the same game.
    """

    def __init__(self, capacity: int, state_size: int = STATE_SIZE, seed: int | None = None):
        self.capacity = capacity
        self.states = np.zeros((capacity, state_size))
        self.actions = np.zeros(capacity, dtype=np.int64)
        self.rewards = np.zeros(capacity)
        self.next_states = np.zeros((capacity, state_size))
        self.terminals = np.zeros(capacity)
        self.pos = 0     # where the next transition goes
        self.size = 0    # how many slots are filled
        self.rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return self.size

    def push(self, state, action, reward, next_state, terminal) -> None:
        i = self.pos
        self.states[i] = state
        self.actions[i] = action
        self.rewards[i] = reward
        self.next_states[i] = next_state
        self.terminals[i] = float(terminal)
        self.pos = (self.pos + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def sample(self, batch_size: int):
        idx = self.rng.integers(0, self.size, size=batch_size)
        return (self.states[idx], self.actions[idx], self.rewards[idx],
                self.next_states[idx], self.terminals[idx])


class Agent:
    def __init__(self, cfg: Config | None = None, seed: int | None = None):
        self.cfg = cfg or Config()
        self.rng = np.random.default_rng(seed)
        self.net = QNetwork(STATE_SIZE, self.cfg.hidden, N_ACTIONS, seed=seed)
        # With target_sync = 0 the "target" is the online network itself.
        self.target = self.net.copy() if self.cfg.target_sync > 0 else self.net
        if self.cfg.optimizer == "adam":
            self.opt = Adam(self.net.params, lr=self.cfg.lr)
        elif self.cfg.optimizer == "sgd":
            self.opt = SGD(self.net.params, lr=self.cfg.lr)
        else:
            raise ValueError(f"unknown optimizer {self.cfg.optimizer!r}")
        self.memory = ReplayMemory(self.cfg.memory, seed=None if seed is None else seed + 1)
        self.updates = 0

    def act(self, state: np.ndarray, epsilon: float = 0.0) -> int:
        """Epsilon-greedy: a random move with probability epsilon, else argmax Q."""
        if self.rng.random() < epsilon:
            return int(self.rng.integers(N_ACTIONS))
        return int(np.argmax(self.net.predict(state)))

    def remember(self, state, action, reward, next_state, terminal) -> None:
        self.memory.push(state, action, reward, next_state, terminal)

    def learn(self) -> float | None:
        """One gradient step on a random batch from memory. Returns the loss."""
        cfg = self.cfg
        if len(self.memory) < max(cfg.batch_size, cfg.learn_start):
            return None

        s, a, r, s2, terminal = self.memory.sample(cfg.batch_size)

        # The target: the reward we got plus the discounted value of the best
        # move from where we landed. If the game ended there, the future is 0.
        q_next = self.target.predict(s2).max(axis=1)
        y = r + cfg.gamma * q_next * (1.0 - terminal)

        q, cache = self.net.forward(s)
        loss, dq = q_loss(q, a, y)
        grads = self.net.backward(cache, dq)
        self.opt.step(self.net.params, grads)

        self.updates += 1
        if cfg.target_sync > 0 and self.updates % cfg.target_sync == 0:
            self.target.load_state(self.net.params)
        return loss
