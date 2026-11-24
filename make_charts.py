"""Draw the README charts from the saved results.

    python make_charts.py          # reads results/, writes assets/*.png

The style follows the guide: paper background, one blue accent for the thing
that matters, grey for everything it is compared with, labels on the lines.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

PAPER = "#fafafa"
INK = "#111113"
INK2 = "#3b3b40"
MUTED = "#8a8a92"
FAINT = "#b9b9c0"
RULE = "#e4e4e8"
BLUE = "#2b4cf2"
BLUE_SOFT = "#a9b7ff"

OUT = Path("assets")

plt.rcParams.update({
    "figure.facecolor": PAPER, "axes.facecolor": PAPER, "savefig.facecolor": PAPER,
    "axes.edgecolor": RULE, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": RULE, "grid.linewidth": 0.8, "axes.axisbelow": True,
    "font.family": "DejaVu Sans", "font.size": 10, "axes.titlesize": 12,
    "axes.titleweight": "bold", "axes.titlecolor": INK, "axes.titlelocation": "left",
    "axes.titlepad": 12, "xtick.major.size": 0, "ytick.major.size": 0,
})


def moving_average(x, n):
    x = np.asarray(x, dtype=float)
    out = np.empty_like(x)
    for i in range(len(x)):
        out[i] = x[max(0, i - n + 1): i + 1].mean()
    return out


def read_log(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def training_curve():
    rows = read_log("results/main/log.csv")
    games = np.array([int(r["game"]) for r in rows])
    scores = np.array([int(r["score"]) for r in rows])
    eps = np.array([float(r["epsilon"]) for r in rows])
    avg = moving_average(scores, 20)
    best = int(scores.max())
    best_game = int(games[scores.argmax()])

    fig, ax = plt.subplots(figsize=(9, 4.4), dpi=150)
    ax.vlines(games, 0, scores, color=BLUE_SOFT, linewidth=1.0, alpha=0.9)
    ax.plot(games, avg, color=BLUE, linewidth=2.2)
    ax.set_title("Score per game while training", color=INK)
    ax.set_xlabel("game")
    ax.set_ylabel("apples eaten")
    ax.set_ylim(0, best * 1.12)

    # where epsilon is high the snake mostly moves at random
    random_until = int(np.argmax(eps < 0.5)) + 1
    ax.axvspan(0, random_until, color=RULE, alpha=0.5, linewidth=0)
    ax.text(random_until / 2, best * 1.03, "mostly random moves\n(epsilon > 0.5)", ha="center",
            va="top", color=MUTED, fontsize=9)
    ax.annotate(f"best game: {best}", xy=(best_game, best), xytext=(best_game + 25, best * 0.98),
                color=INK2, fontsize=9, arrowprops=dict(arrowstyle="-", color=FAINT, lw=0.8))
    ax.text(games[-1] + 4, avg[-1], "20-game\naverage", color=BLUE, fontsize=9, va="center")
    ax.set_xlim(0, len(games) + 45)
    ax.set_xticks(range(0, len(games) + 1, 50))
    fig.tight_layout()
    fig.savefig(OUT / "training_curve.png")
    plt.close(fig)


def ablations():
    summary = json.loads(Path("results/experiments/summary.json").read_text())
    v = summary["variants"]
    groups = [
        ("Replay memory and target network", "stability"),
        ("Discount factor gamma", "gamma"),
        ("Hidden layer size", "hidden"),
        ("Learning rate", "lr"),
        ("Optimiser", "optimizer"),
        ("Exploration schedule", "epsilon"),
    ]
    fig, axes = plt.subplots(len(groups), 1, figsize=(9, 11.5), dpi=150, sharex=True,
                             gridspec_kw={"height_ratios": [len(summary["groups"][g]) for _, g in groups]})
    for ax, (title, key) in zip(axes, groups):
        rows = summary["groups"][key]
        labels = [label for _, label in rows]
        means = [v[name]["eval_mean"] for name, _ in rows]
        stds = [v[name]["eval_std"] for name, _ in rows]
        y = np.arange(len(rows))[::-1]
        for yi, name, m, s in zip(y, [n for n, _ in rows], means, stds):
            color = BLUE if name == "baseline" else MUTED
            ax.hlines(yi, m - s, m + s, color=color, linewidth=1.6)
            ax.plot(m, yi, "o", color=color, markersize=8, markeredgecolor=PAPER, markeredgewidth=2)
            ax.text(m + s + 0.8, yi, f"{m:.1f}", va="center", color=INK2, fontsize=9)
        ax.set_yticks(y, labels, color=INK2)
        ax.set_title(title)
        ax.grid(axis="y", visible=False)
        ax.set_ylim(-0.7, len(rows) - 0.3)
    axes[-1].set_xlabel("mean score over 100 greedy games  (dot = mean of 5 seeds, line = ± 1 std)")
    axes[-1].set_xlim(0, 40)
    fig.suptitle("What each setting changes  (blue = the default)", x=0.02, ha="left",
                 fontsize=13, fontweight="bold", color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "ablations.png")
    plt.close(fig)


def learning_speed():
    """Average curves of the stability variants: does it change how fast it learns?"""
    names = [("baseline", "replay + target (default)", BLUE, "-", 2.4),
             ("no_target", "no target network", MUTED, ":", 1.8),
             ("no_replay", "no replay memory", MUTED, "--", 1.6),
             ("gamma_0", "gamma = 0", INK2, "-", 1.6)]
    fig, ax = plt.subplots(figsize=(9, 4.4), dpi=150)
    ends = []
    for name, label, color, style, width in names:
        m = moving_average(read_log_simple(f"results/experiments/{name}.csv"), 20)
        ax.plot(np.arange(1, len(m) + 1), m, color=color, linestyle=style, linewidth=width)
        ends.append([m[-1], label, color])
    # spread the end labels so they never overlap (at least 1.8 units apart)
    ends.sort(key=lambda e: e[0])
    for i in range(1, len(ends)):
        ends[i][0] = max(ends[i][0], ends[i - 1][0] + 1.8)
    for y, label, color in ends:
        ax.text(406, y, label, color=color, va="center", fontsize=9)
    ax.set_xlim(0, 540)
    ax.set_xticks(range(0, 401, 50))
    ax.set_title("Learning curves, average of 5 seeds (20-game moving average)")
    ax.set_xlabel("game")
    ax.set_ylabel("apples eaten")
    fig.tight_layout()
    fig.savefig(OUT / "learning_speed.png")
    plt.close(fig)


def read_log_simple(path):
    with open(path) as f:
        return [float(r["mean"]) for r in csv.DictReader(f)]


def baselines():
    a = json.loads(Path("results/analysis.json").read_text())["baselines"]
    names = [("random", "random moves"), ("rule", "hand-written rule"), ("network", "trained network")]
    fig, ax = plt.subplots(figsize=(9, 2.6), dpi=150)
    for i, (key, label) in enumerate(names):
        y = len(names) - 1 - i
        m = a[key]["mean"]
        ax.barh(y, m, height=0.5, color=BLUE if key == "network" else FAINT)
        ax.text(m + 0.5, y, f"{m:.2f}", va="center", color=INK2, fontsize=9)
    ax.set_yticks(range(len(names)), [label for _, label in names][::-1], color=INK2)
    ax.grid(axis="y", visible=False)
    ax.set_xlim(0, 32)
    ax.set_title("Mean score on the same 100 boards")
    fig.tight_layout()
    fig.savefig(OUT / "baselines.png")
    plt.close(fig)


def main():
    OUT.mkdir(exist_ok=True)
    training_curve()
    ablations()
    learning_speed()
    baselines()
    print("wrote", ", ".join(sorted(str(p) for p in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
