"""The hand-written rule and the input-space enumeration used in the analysis."""

import numpy as np

from snake_ai.baselines import heading, random_policy, rule_policy
from snake_ai.game import DOWN, RIGHT, STRAIGHT, TURN_LEFT, TURN_RIGHT, UP, SnakeGame
from snake_ai.training import evaluate


def s(danger=(0, 0, 0), d=RIGHT, food=(0, 0, 0, 0)):
    onehot = {RIGHT: (1, 0, 0, 0), DOWN: (0, 1, 0, 0), UP: (0, 0, 0, 1)}[d]
    return np.array([*danger, *onehot, *food], dtype=float)


def test_heading_reads_the_one_hot():
    assert heading(s(d=UP)) == UP
    assert heading(s(d=DOWN)) == DOWN


def test_rule_goes_towards_food_when_safe():
    # going right, food is up: turning left points up
    assert rule_policy(s(food=(0, 0, 1, 0))) == TURN_LEFT
    # going right, food is down: turning right points down
    assert rule_policy(s(food=(0, 0, 0, 1))) == TURN_RIGHT
    # going right, food is right: straight
    assert rule_policy(s(food=(0, 1, 0, 0))) == STRAIGHT


def test_rule_avoids_danger_first():
    # food is up (left turn) but left is dangerous: take a safe move instead
    a = rule_policy(s(danger=(0, 0, 1), food=(0, 0, 1, 0)))
    assert a in (STRAIGHT, TURN_RIGHT)


def test_rule_beats_random_by_a_mile():
    rule = evaluate(rule_policy, games=20)["mean"]
    rnd = evaluate(random_policy(0), games=20)["mean"]
    assert rule > 10 > rnd


def test_analysis_covers_every_state_the_game_makes():
    from analyze import all_states
    states = set(all_states())
    assert len(states) == 256
    g = SnakeGame(10, 10, seed=0)
    rng = np.random.default_rng(0)
    for _ in range(3000):
        if g.done:
            g.reset()
        g.step(int(rng.integers(3)))
        assert tuple(int(v) for v in g.get_state()) in states or g.food is None
