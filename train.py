"""Train the Snake agent from scratch.

    python train.py                      # the main run: 400 games, saves models/snake_q.npz
    python train.py --games 100 --out runs/quick
    python train.py --gamma 0.5 --hidden 16 --out runs/small

A run writes three files into --out: log.csv (one row per game), model.npz
(the weights) and summary.json (config plus a 100-game greedy evaluation).
"""

from __future__ import annotations

import argparse
import json
from dataclasses import fields
from pathlib import Path

from snake_ai.agent import Config
from snake_ai.training import evaluate, train


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", type=int, default=400, help="number of training games")
    parser.add_argument("--seed", type=int, default=0, help="random seed for the game and the network")
    parser.add_argument("--out", default="runs/main", help="folder for log.csv, model.npz and summary.json")
    parser.add_argument("--save-model", default=None,
                        help="also copy the weights here (e.g. models/snake_q.npz)")
    parser.add_argument("--eval-games", type=int, default=100, help="greedy games for the final evaluation")
    defaults = Config()
    for f in fields(Config):
        parser.add_argument(f"--{f.name.replace('_', '-')}", type=type(getattr(defaults, f.name)),
                            default=getattr(defaults, f.name), help=f"(default {getattr(defaults, f.name)})")
    args = parser.parse_args()

    cfg = Config(**{f.name: getattr(args, f.name) for f in fields(Config)})
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"training for {args.games} games, seed {args.seed}")
    print("config:", json.dumps(cfg.to_dict()))
    agent, history = train(cfg, args.games, seed=args.seed,
                           log_path=out / "log.csv", model_path=out / "model.npz")
    if args.save_model:
        agent.net.save(args.save_model, config=cfg.to_dict(), games=args.games, seed=args.seed,
                       record=max(h["score"] for h in history))

    stats = evaluate(agent.net, games=args.eval_games, board=cfg.board)
    summary = {
        "config": cfg.to_dict(),
        "games": args.games,
        "seed": args.seed,
        "train_seconds": history[-1]["seconds"],
        "train_record": max(h["score"] for h in history),
        "eval": {k: v for k, v in stats.items() if k != "scores"},
        "eval_scores": stats["scores"],
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\ngreedy evaluation over {stats['games']} games: mean {stats['mean']:.2f}, "
          f"median {stats['median']:.0f}, max {stats['max']}, ends {stats['end_reasons']}")
    print(f"saved {out / 'model.npz'}" + (f" and {args.save_model}" if args.save_model else ""))


if __name__ == "__main__":
    main()
