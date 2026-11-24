"""Two policies that are not learned, to measure the network against.

A score only means something next to a baseline. ``random_policy`` is the
floor. ``rule_policy`` is the rule a person would write after looking at the
same 11 inputs: never move into danger, and prefer a move that heads towards
the food. If the network cannot beat or match that rule, it has not learned
much.
"""

from __future__ import annotations

import numpy as np

from .game import CLOCKWISE, DOWN, LEFT, RIGHT, STRAIGHT, TURN_LEFT, TURN_RIGHT, UP, turn

# index of each direction's one-hot input, and of each food input
_DIR_INPUT = {RIGHT: 3, DOWN: 4, LEFT: 5, UP: 6}
_TOWARDS_FOOD_INPUT = {LEFT: 7, RIGHT: 8, UP: 9, DOWN: 10}
_DANGER_INPUT = {STRAIGHT: 0, TURN_RIGHT: 1, TURN_LEFT: 2}


def random_policy(seed: int = 0):
    rng = np.random.default_rng(seed)
    return lambda state: int(rng.integers(3))


def heading(state) -> tuple[int, int]:
    """Read the absolute direction back out of the one-hot inputs 3..6."""
    for d in CLOCKWISE:
        if state[_DIR_INPUT[d]] > 0:
            return d
    raise ValueError("state has no direction set")


def rule_policy(state) -> int:
    """Safe and towards the food, else safe, else straight (it is doomed anyway)."""
    d = heading(state)
    safe = [a for a in (STRAIGHT, TURN_RIGHT, TURN_LEFT) if state[_DANGER_INPUT[a]] == 0]
    towards = [a for a in safe if state[_TOWARDS_FOOD_INPUT[turn(d, a)]] > 0]
    if towards:
        return towards[0]
    if safe:
        return safe[0]
    return STRAIGHT
