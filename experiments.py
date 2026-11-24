"""Run the ablation study: change one setting at a time, train several seeds of each.

    python experiments.py                  # everything, in parallel on all cores
    python experiments.py --only gamma     # one group
    python experiments.py --seeds 3 --workers 4

For every variant it trains --seeds independent runs and writes, under
results/experiments/:

    <variant>.csv    per-game score averaged over seeds (plus min and max)
    summary.json     one entry per variant: last-100 training mean and greedy
                     evaluation mean, each as mean and std over seeds
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

import numpy as np

from snake_ai.agent import Config
from snake_ai.training import evaluate, train

BASE = Config()
NO_REPLAY = dict(memory=1, batch_size=1, learn_start=1)

# group -> list of (variant name, label for charts, config changes, games)
EXPERIMENTS = {
    "baseline": [("baseline", "baseline", {}, 400)],
    "long": [("long_2000", "2000 games", {}, 2000)],
    "stability": [
        ("baseline", "replay + target", {}, 400),
        ("no_target", "no target network", dict(target_sync=0), 400),
        ("no_replay", "no replay memory", NO_REPLAY, 400),
        ("no_replay_no_target", "neither", dict(NO_REPLAY, target_sync=0), 400),
    ],
    "gamma": [
        ("gamma_0", "gamma 0", dict(gamma=0.0), 400),
        ("gamma_0.5", "gamma 0.5", dict(gamma=0.5), 400),
        ("baseline", "gamma 0.9", {}, 400),
        ("gamma_0.99", "gamma 0.99", dict(gamma=0.99), 400),
    ],
    "hidden": [
        ("hidden_4", "4 hidden", dict(hidden=4), 400),
        ("hidden_16", "16 hidden", dict(hidden=16), 400),
        ("baseline", "64 hidden", {}, 400),
        ("hidden_256", "256 hidden", dict(hidden=256), 400),
    ],
    "lr": [
        ("lr_1e-4", "lr 0.0001", dict(lr=1e-4), 400),
        ("baseline", "lr 0.001", {}, 400),
        ("lr_1e-2", "lr 0.01", dict(lr=1e-2), 400),
    ],
    "optimizer": [
        ("baseline", "Adam, lr 0.001", {}, 400),
        ("sgd_1e-3", "SGD, lr 0.001", dict(optimizer="sgd", lr=1e-3), 400),
        ("sgd_1e-2", "SGD, lr 0.01", dict(optimizer="sgd", lr=1e-2), 400),
    ],
    "epsilon": [
        ("eps_none", "no decay (always 0.01)", dict(eps_decay_games=0), 400),
        ("eps_50", "decay over 50", dict(eps_decay_games=50), 400),
        ("baseline", "decay over 150", {}, 400),
        ("eps_300", "decay over 300", dict(eps_decay_games=300), 400),
    ],
}


def run_one(job):
    name, changes, games, seed = job
    cfg = replace(BASE, **changes)
    t0 = time.perf_counter()
    agent, history = train(cfg, games, seed=seed, verbose=False)
    stats = evaluate(agent.net, games=100, board=cfg.board, seed=10_000 + seed)
    return {
        "name": name,
        "seed": seed,
        "scores": [h["score"] for h in history],
        "eval_mean": stats["mean"],
        "eval_max": stats["max"],
        "seconds": time.perf_counter() - t0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--only", default=None, help="run one group: " + ", ".join(EXPERIMENTS))
    parser.add_argument("--out", default="results/experiments")
    args = parser.parse_args()

    groups = {args.only: EXPERIMENTS[args.only]} if args.only else EXPERIMENTS
    variants = {}
    for group in groups.values():
        for name, _label, changes, games in group:
            variants[name] = (changes, games)

    jobs = [(name, changes, games, seed) for name, (changes, games) in variants.items()
            for seed in range(args.seeds)]
    # longest jobs first so the pool finishes evenly
    jobs.sort(key=lambda j: -j[2])
    print(f"{len(variants)} variants x {args.seeds} seeds = {len(jobs)} runs on {args.workers} workers")

    t0 = time.perf_counter()
    results: dict[str, list] = {name: [] for name in variants}
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for r in pool.map(run_one, jobs):
            results[r["name"]].append(r)
            print(f"  {r['name']:22s} seed {r['seed']}  last-100 mean "
                  f"{np.mean(r['scores'][-100:]):6.2f}  eval mean {r['eval_mean']:6.2f}  "
                  f"({r['seconds']:.0f}s)", flush=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary_path = out / "summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {"variants": {}}
    summary["groups"] = {g: [[n, label] for n, label, _, _ in rows] for g, rows in EXPERIMENTS.items()}

    for name, runs in results.items():
        runs.sort(key=lambda r: r["seed"])
        scores = np.array([r["scores"] for r in runs], dtype=float)  # (seeds, games)
        with open(out / f"{name}.csv", "w") as f:
            f.write("game,mean,min,max\n")
            for g in range(scores.shape[1]):
                col = scores[:, g]
                f.write(f"{g + 1},{col.mean():.2f},{col.min():.0f},{col.max():.0f}\n")
        last100 = scores[:, -100:].mean(axis=1)
        evals = np.array([r["eval_mean"] for r in runs])
        summary["variants"][name] = {
            "changes": variants[name][0],
            "games": variants[name][1],
            "seeds": len(runs),
            "last100_mean": round(float(last100.mean()), 2),
            "last100_std": round(float(last100.std()), 2),
            "eval_mean": round(float(evals.mean()), 2),
            "eval_std": round(float(evals.std()), 2),
            "eval_per_seed": [round(float(e), 2) for e in evals],
            "eval_best_game": int(max(r["eval_max"] for r in runs)),
            "seconds_per_run": round(float(np.mean([r["seconds"] for r in runs])), 1),
        }

    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"\ndone in {time.perf_counter() - t0:.0f}s, wrote {out}/")
    print(f"\n{'variant':24s}{'last-100 train':>18s}{'greedy eval':>16s}")
    for name in variants:
        v = summary["variants"][name]
        print(f"{name:24s}{v['last100_mean']:10.2f} ± {v['last100_std']:<5.2f}"
              f"{v['eval_mean']:9.2f} ± {v['eval_std']:<5.2f}")


if __name__ == "__main__":
    main()
