"""Measure a trained network: play N games with no exploration and report the scores.

    python evaluate.py                         # models/snake_q.npz, 100 games
    python evaluate.py --model runs/main/model.npz --games 500
    python evaluate.py --random                # baseline: an untrained network
"""

from __future__ import annotations

import argparse

import numpy as np

from snake_ai.network import QNetwork
from snake_ai.training import evaluate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/snake_q.npz")
    parser.add_argument("--random", action="store_true", help="evaluate an untrained network")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--board", type=int, default=20)
    parser.add_argument("--seed", type=int, default=12345)
    args = parser.parse_args()

    net = QNetwork(seed=0) if args.random else QNetwork.load(args.model)
    stats = evaluate(net, games=args.games, board=args.board, seed=args.seed)
    scores = np.array(stats["scores"])
    print(f"model:   {'untrained network' if args.random else args.model}")
    print(f"games:   {stats['games']} on a {args.board}x{args.board} board, epsilon = 0")
    print(f"score:   mean {stats['mean']:.2f}  median {stats['median']:.0f}  "
          f"std {stats['std']:.2f}  min {stats['min']}  max {stats['max']}")
    print(f"steps:   mean {stats['mean_steps']:.0f} per game")
    print(f"ended:   {stats['end_reasons']}")
    hist, edges = np.histogram(scores, bins=10)
    print("\nscore histogram")
    for count, lo, hi in zip(hist, edges[:-1], edges[1:]):
        print(f"  {lo:5.1f} - {hi:5.1f}  {'#' * int(count)}")


if __name__ == "__main__":
    main()
