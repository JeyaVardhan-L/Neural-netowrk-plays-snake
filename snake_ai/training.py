"""The training loop and the evaluation loop.

Training plays games one after another. Every step: look at the state, pick a
move, play it, store what happened, and take one gradient step on a random
batch from memory. That is the whole algorithm.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

import numpy as np

from .agent import Agent, Config, epsilon_for_game
from .game import SnakeGame
from .network import QNetwork

LOG_FIELDS = ["game", "score", "steps", "epsilon", "loss", "reason", "record", "seconds"]


def train(cfg: Config, games: int, seed: int = 0, log_path=None, model_path=None,
          verbose: bool = True, print_every: int = 25):
    """Train a fresh agent for ``games`` games. Returns ``(agent, history)``.

    ``history`` is a list of dicts, one per game, with the fields in LOG_FIELDS.
    If ``log_path`` is given the same rows are written there as CSV. If
    ``model_path`` is given, the weights are saved there at the end.
    """
    agent = Agent(cfg, seed=seed)
    game = SnakeGame(cfg.board, cfg.board, seed=seed)
    history = []
    record = 0
    t0 = time.perf_counter()

    log_file = None
    writer = None
    if log_path is not None:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        log_file = open(log_path, "w", newline="")
        writer = csv.DictWriter(log_file, fieldnames=LOG_FIELDS)
        writer.writeheader()

    try:
        for g in range(games):
            eps = epsilon_for_game(g, cfg)
            state = game.reset()
            losses = []
            done = False
            info = {}
            while not done:
                action = agent.act(state, eps)
                next_state, reward, done, info = game.step(action)
                agent.remember(state, action, reward, next_state, info["terminal"])
                loss = agent.learn()
                if loss is not None:
                    losses.append(loss)
                state = next_state

            record = max(record, game.score)
            row = {
                "game": g + 1,
                "score": game.score,
                "steps": game.steps,
                "epsilon": round(eps, 4),
                "loss": round(float(np.mean(losses)), 5) if losses else "",
                "reason": info.get("reason", ""),
                "record": record,
                "seconds": round(time.perf_counter() - t0, 2),
            }
            history.append(row)
            if writer is not None:
                writer.writerow(row)
            if verbose and ((g + 1) % print_every == 0 or g == 0):
                recent = [h["score"] for h in history[-print_every:]]
                print(f"game {g + 1:5d}  score {game.score:3d}  "
                      f"mean(last {len(recent)}) {np.mean(recent):6.2f}  record {record:3d}  "
                      f"eps {eps:.3f}  {row['seconds']:7.1f}s", flush=True)
    finally:
        if log_file is not None:
            log_file.close()

    if model_path is not None:
        Path(model_path).parent.mkdir(parents=True, exist_ok=True)
        agent.net.save(model_path, config=cfg.to_dict(), games=games, seed=seed, record=record)
    return agent, history


def greedy_policy(net: QNetwork):
    """Turn a network into a policy: state in, the move with the highest Q-value out."""
    return lambda state: int(np.argmax(net.predict(state)))


def play_greedy(policy, game: SnakeGame):
    """Play one game with no exploration. Yields the game after every step.

    ``policy`` is a QNetwork or any function from a state to an action.
    """
    if isinstance(policy, QNetwork):
        policy = greedy_policy(policy)
    state = game.reset()
    yield game
    while not game.done:
        state, _, _, _ = game.step(policy(state))
        yield game


def evaluate(policy, games: int = 100, board: int = 20, seed: int = 12345):
    """Play ``games`` games with no exploration. Returns a dict of statistics.

    ``policy`` is a QNetwork or any function from a state to an action, so the
    same code measures the network and the baselines.
    """
    game = SnakeGame(board, board, seed=seed)
    scores, steps, reasons = [], [], {}
    for _ in range(games):
        for _ in play_greedy(policy, game):
            pass
        scores.append(game.score)
        steps.append(game.steps)
        reasons[game.end_reason] = reasons.get(game.end_reason, 0) + 1
    scores = np.array(scores)
    return {
        "games": games,
        "mean": float(scores.mean()),
        "median": float(np.median(scores)),
        "std": float(scores.std()),
        "min": int(scores.min()),
        "max": int(scores.max()),
        "mean_steps": float(np.mean(steps)),
        "end_reasons": reasons,
        "scores": scores.tolist(),
    }
