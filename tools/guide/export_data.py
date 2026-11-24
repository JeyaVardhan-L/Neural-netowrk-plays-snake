"""Export everything the guide's figures need into docs/assets/data.js.

    python tools/guide/export_data.py           # write the file
    python tools/guide/export_data.py --check   # fail if the file is out of date

Nothing in the guide's charts is typed by hand: the weights, the training log,
the experiment curves and the analysis all come from results/ and models/.

It also writes "parity" fixtures: game positions and one complete game played
by the Python code. The guide replays them in JavaScript and checks that its
port of the game and the network gives exactly the same inputs, Q-values and
moves (see the selfTest function in figures.js).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from snake_ai.game import CLOCKWISE, SnakeGame  # noqa: E402
from snake_ai.network import QNetwork  # noqa: E402

OUT = ROOT / "docs" / "assets" / "data.js"


def r(x, n=3):
    return round(float(x), n)


def load_csv(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def model_data(net: QNetwork):
    # full precision so the browser computes exactly the same Q-values
    return {k: v.tolist() for k, v in net.params.items()}


def main_log():
    rows = load_csv(ROOT / "results/main/log.csv")
    return {
        "score": [int(x["score"]) for x in rows],
        "steps": [int(x["steps"]) for x in rows],
        "epsilon": [float(x["epsilon"]) for x in rows],
        "loss": [float(x["loss"]) if x["loss"] else None for x in rows],
        "seconds": [float(x["seconds"]) for x in rows],
    }


def experiments():
    summary = json.loads((ROOT / "results/experiments/summary.json").read_text())
    curves = {}
    for name in summary["variants"]:
        rows = load_csv(ROOT / f"results/experiments/{name}.csv")
        curves[name] = [float(x["mean"]) for x in rows]
    return {"groups": summary["groups"], "variants": summary["variants"], "curves": curves}


def analysis():
    a = json.loads((ROOT / "results/analysis.json").read_text())
    return {
        "baselines": {k: {kk: v[kk] for kk in ("mean", "median", "max", "std")} for k, v in a["baselines"].items()},
        "baseline_scores": {k: v["scores"] for k, v in a["baselines"].items()},
        "n_states": a["n_states"],
        "states_seen": a["states_seen"],
        "steps": a["steps"],
        "agree_states": a["agree_states"],
        "agree_steps_pct": a["agree_steps_pct"],
        "table": [[t["state"], t["visits"], t["rule"]] for t in a["table"]],
    }


def frame(game: SnakeGame, net: QNetwork):
    s = game.get_state()
    return {
        "snake": [list(p) for p in game.snake],
        "dir": CLOCKWISE.index(game.direction),
        "food": list(game.food) if game.food else None,
        "score": game.score,
        "state": [int(v) for v in s],
        "q": [r(v, 4) for v in net.predict(s)],
    }


def death_replay(net: QNetwork, frames_kept: int = 36):
    """A real game where the snake traps itself. Keep its last frames."""
    best = None
    for seed in range(200):
        game = SnakeGame(20, 20, seed=seed)
        state = game.reset()
        frames = [frame(game, net)]
        while not game.done:
            state, _, _, _ = game.step(int(np.argmax(net.predict(state))))
            frames.append(frame(game, net))
            frames = frames[-(frames_kept + 1):]
        # we want a body death where the last few frames had no danger warnings
        # until the end: the snake walked into a pocket it could not see
        if game.end_reason == "body" and 25 <= game.score <= 45:
            quiet = sum(1 for f in frames[-12:-3] if sum(f["state"][:3]) == 0)
            if best is None or quiet > best[0]:
                best = (quiet, seed, frames)
            if quiet >= 7:
                break
    _, seed, frames = best
    return {"seed": seed, "frames": frames}


def parity(net: QNetwork):
    """Fixtures for the JavaScript port."""
    rng = np.random.default_rng(99)
    positions = []
    game = SnakeGame(20, 20, seed=5)
    state = game.reset()
    while len(positions) < 60:
        if game.done:
            state = game.reset()
        a = int(np.argmax(net.predict(state))) if rng.random() > 0.2 else int(rng.integers(3))
        state, _, _, _ = game.step(a)
        if not game.done and rng.random() < 0.08:
            f = frame(game, net)
            f["q"] = [float(v) for v in net.predict(game.get_state())]
            positions.append(f)

    # one full greedy game: the food positions in order, the moves, the outcome
    game = SnakeGame(20, 20, seed=11)
    state = game.reset()
    foods = [list(game.food)]
    actions = []
    while not game.done:
        a = int(np.argmax(net.predict(state)))
        actions.append(a)
        state, _, _, _ = game.step(a)
        if game.food is not None and list(game.food) != foods[-1]:
            foods.append(list(game.food))
    full = {"foods": foods, "actions": actions, "score": game.score, "steps": game.steps,
            "end": game.end_reason}
    return {"positions": positions, "game": full}


def build() -> str:
    net = QNetwork.load(ROOT / "models/snake_q.npz")
    main_summary = json.loads((ROOT / "results/main/summary.json").read_text())
    data = {
        "model": model_data(net),
        "main": {
            "config": main_summary["config"],
            "games": main_summary["games"],
            "train_seconds": main_summary["train_seconds"],
            "train_record": main_summary["train_record"],
            "eval": main_summary["eval"],
            "eval_scores": main_summary["eval_scores"],
            "n_params": net.n_params(),
            "log": main_log(),
        },
        "experiments": experiments(),
        "analysis": analysis(),
        "death": death_replay(net),
        "parity": parity(net),
    }
    body = json.dumps(data, separators=(",", ":"))
    return ("// Generated by tools/guide/export_data.py from results/ and models/. Do not edit.\n"
            f"window.GUIDE_DATA = {body};\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if data.js is out of date")
    args = parser.parse_args()
    text = build()
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python tools/guide/export_data.py")
            sys.exit(1)
        print(f"{OUT.relative_to(ROOT)} is up to date")
        return
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
