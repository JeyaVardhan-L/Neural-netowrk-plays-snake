"""Look inside the trained agent and compare it with the baselines.

    python analyze.py                       # writes results/analysis.json

1. Baselines: random moves, the hand-written rule, and the network, on the
   same 100 boards.
2. The whole input space: the 11 inputs can only take 256 combinations
   (8 danger patterns x 4 headings x 8 food directions). We list every one,
   how often the trained snake actually meets it, what the network does there
   and what the rule does there.
"""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

import numpy as np

from snake_ai.baselines import random_policy, rule_policy
from snake_ai.game import ACTION_NAMES, SnakeGame
from snake_ai.network import QNetwork
from snake_ai.training import evaluate, play_greedy

FOOD_PATTERNS = [(l, r, u, d) for l, r, u, d in itertools.product((0, 1), repeat=4)
                 if not (l and r) and not (u and d) and (l or r or u or d)]


def all_states():
    """Every combination of inputs the game can produce (256)."""
    states = []
    for danger in itertools.product((0, 1), repeat=3):
        for heading in range(4):
            onehot = [0, 0, 0, 0]
            onehot[heading] = 1
            for food in FOOD_PATTERNS:
                states.append((*danger, *onehot, *food))
    return states


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/snake_q.npz")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--out", default="results/analysis.json")
    args = parser.parse_args()

    net = QNetwork.load(args.model)

    print("baselines on the same boards (epsilon = 0):")
    baselines = {}
    for name, policy in [("random", random_policy(0)), ("rule", rule_policy), ("network", net)]:
        s = evaluate(policy, games=args.games)
        baselines[name] = {k: s[k] for k in ("mean", "median", "std", "max", "mean_steps", "end_reasons")}
        baselines[name]["scores"] = s["scores"]
        print(f"  {name:8s} mean {s['mean']:6.2f}  median {s['median']:4.0f}  max {s['max']:3d}  "
              f"ends {s['end_reasons']}")

    # Count which inputs the trained snake actually sees.
    visits: dict[tuple, int] = {}
    game = SnakeGame(20, 20, seed=12345)
    for _ in range(args.games):
        for g in play_greedy(net, game):
            if not g.done:
                key = tuple(int(v) for v in g.get_state())
                visits[key] = visits.get(key, 0) + 1
    total_visits = sum(visits.values())

    states = all_states()
    x = np.array(states, dtype=float)
    q = net.predict(x)
    table = []
    agree_weighted = 0
    agree_states = 0
    for i, s in enumerate(states):
        net_a = int(np.argmax(q[i]))
        rule_a = rule_policy(np.array(s, dtype=float))
        n = visits.get(s, 0)
        same = net_a == rule_a
        agree_states += same
        agree_weighted += same * n
        table.append({"state": list(s), "q": [round(float(v), 3) for v in q[i]],
                      "network": ACTION_NAMES[net_a], "rule": ACTION_NAMES[rule_a], "visits": n})

    seen = sum(1 for s in states if visits.get(s, 0) > 0)
    unknown = [s for s in visits if s not in set(states)]
    assert not unknown, f"the game produced inputs outside the 256: {unknown[:3]}"
    print(f"\ninput space: {len(states)} combinations, {seen} seen in {args.games} greedy games "
          f"({total_visits} steps)")
    print(f"network and rule agree on {agree_states}/{len(states)} combinations, and on "
          f"{100 * agree_weighted / total_visits:.1f}% of the steps actually played")

    out = {
        "model": args.model,
        "games": args.games,
        "baselines": baselines,
        "n_states": len(states),
        "states_seen": seen,
        "steps": total_visits,
        "agree_states": agree_states,
        "agree_steps_pct": round(100 * agree_weighted / total_visits, 2),
        "table": table,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
