"""Replay memory, epsilon, the Q-learning target, and a short training smoke test."""

import numpy as np

from snake_ai.agent import Agent, Config, ReplayMemory, epsilon_for_game
from snake_ai.training import evaluate, train


def test_epsilon_schedule():
    cfg = Config(eps_start=1.0, eps_end=0.0, eps_decay_games=100)
    assert epsilon_for_game(0, cfg) == 1.0
    assert np.isclose(epsilon_for_game(50, cfg), 0.5)
    assert epsilon_for_game(100, cfg) == 0.0
    assert epsilon_for_game(1000, cfg) == 0.0


def test_memory_ring_buffer_overwrites_oldest():
    m = ReplayMemory(3, state_size=2, seed=0)
    for i in range(5):
        m.push([i, i], i % 3, float(i), [i + 1, i + 1], False)
    assert len(m) == 3
    assert sorted(m.rewards.tolist()) == [2.0, 3.0, 4.0]
    s, a, r, s2, t = m.sample(10)
    assert s.shape == (10, 2) and a.shape == (10,) and set(r) <= {2.0, 3.0, 4.0}
    assert np.allclose(s2 - s, 1)


def test_greedy_action_is_argmax():
    agent = Agent(Config(hidden=8), seed=0)
    state = np.ones(11)
    q = agent.net.predict(state)
    assert agent.act(state, epsilon=0.0) == int(np.argmax(q))


def test_epsilon_one_is_uniform():
    agent = Agent(Config(hidden=8), seed=0)
    counts = np.bincount([agent.act(np.zeros(11), 1.0) for _ in range(3000)], minlength=3)
    assert np.all(np.abs(counts / 3000 - 1 / 3) < 0.04)


def test_learn_waits_for_enough_memory():
    agent = Agent(Config(hidden=8, batch_size=4, learn_start=10), seed=0)
    for i in range(9):
        agent.remember(np.zeros(11), 0, 0.0, np.zeros(11), False)
        assert agent.learn() is None
    agent.remember(np.zeros(11), 0, 0.0, np.zeros(11), False)
    assert agent.learn() is not None


def test_target_uses_bellman_equation():
    """With one stored transition the update must move Q(s,a) towards r + gamma * max Q(s')."""
    cfg = Config(hidden=8, batch_size=1, learn_start=1, memory=1, gamma=0.5, lr=1e-2, target_sync=10_000)
    agent = Agent(cfg, seed=0)
    s = np.zeros(11); s[0] = 1
    s2 = np.zeros(11); s2[5] = 1
    agent.remember(s, 1, 10.0, s2, False)
    y = 10.0 + 0.5 * agent.target.predict(s2).max()
    for _ in range(300):
        agent.learn()
    assert abs(agent.net.predict(s)[1] - y) < 0.5


def test_terminal_ignores_the_future():
    cfg = Config(hidden=8, batch_size=1, learn_start=1, memory=1, lr=1e-2, target_sync=10_000)
    agent = Agent(cfg, seed=0)
    s = np.zeros(11); s[1] = 1
    agent.remember(s, 0, -10.0, np.ones(11), True)
    for _ in range(300):
        agent.learn()
    assert abs(agent.net.predict(s)[0] - (-10.0)) < 0.5


def test_target_network_syncs():
    cfg = Config(hidden=8, batch_size=2, learn_start=2, target_sync=5)
    agent = Agent(cfg, seed=0)
    rng = np.random.default_rng(0)
    for _ in range(20):
        agent.remember(rng.random(11), int(rng.integers(3)), 1.0, rng.random(11), False)
    for _ in range(4):
        agent.learn()
    assert not np.array_equal(agent.net.W1, agent.target.W1)  # frozen so far
    agent.learn()                                               # 5th update: sync
    assert np.array_equal(agent.net.W1, agent.target.W1)


def test_no_target_network_option():
    agent = Agent(Config(hidden=8, target_sync=0), seed=0)
    assert agent.target is agent.net


def test_short_training_run_learns_something(tmp_path):
    """60 quick games should beat an untrained network. Not a benchmark, a smoke test."""
    cfg = Config(eps_decay_games=40, learn_start=200)
    agent, history = train(cfg, 60, seed=0, log_path=tmp_path / "log.csv",
                           model_path=tmp_path / "m.npz", verbose=False)
    assert len(history) == 60
    assert (tmp_path / "log.csv").read_text().startswith("game,score")
    trained = evaluate(agent.net, games=20, seed=1)["mean"]
    untrained = evaluate(Agent(cfg, seed=0).net, games=20, seed=1)["mean"]
    assert trained > untrained
