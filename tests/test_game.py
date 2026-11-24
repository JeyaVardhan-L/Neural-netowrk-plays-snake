"""The rules of the game and the 11 inputs."""

import numpy as np
import pytest

from snake_ai.game import (DOWN, LEFT, REWARD_CRASH, REWARD_FOOD, RIGHT, STATE_LABELS, STRAIGHT,
                           TURN_LEFT, TURN_RIGHT, UP, SnakeGame, turn)


def make_game(snake, direction, food, size=10):
    """A game with a hand-placed snake (head first) and food."""
    g = SnakeGame(size, size, seed=0)
    g.snake.clear()
    g.snake.extend(snake)
    g.body = set(snake)
    g.direction = direction
    g.food = food
    return g


def state_dict(g):
    return dict(zip(STATE_LABELS, g.get_state().astype(int)))


def test_turn_is_relative():
    assert turn(RIGHT, STRAIGHT) == RIGHT
    assert turn(RIGHT, TURN_RIGHT) == DOWN   # y grows downwards
    assert turn(RIGHT, TURN_LEFT) == UP
    assert turn(UP, TURN_RIGHT) == RIGHT
    assert turn(UP, TURN_LEFT) == LEFT
    # four right turns bring you back
    d = LEFT
    for _ in range(4):
        d = turn(d, TURN_RIGHT)
    assert d == LEFT
    with pytest.raises(ValueError):
        turn(RIGHT, 3)


def test_reset_shape():
    g = SnakeGame(20, 20, seed=1)
    s = g.reset()
    assert s.shape == (11,)
    assert len(g.snake) == 3 and g.snake[0] == (10, 10)
    assert g.direction == RIGHT
    assert g.food not in g.body
    assert set(np.unique(s)) <= {0.0, 1.0}


def test_moves_forward_without_growing():
    g = make_game([(5, 5), (4, 5), (3, 5)], RIGHT, food=(0, 0))
    _, reward, done, _ = g.step(STRAIGHT)
    assert list(g.snake) == [(6, 5), (5, 5), (4, 5)]
    assert reward == 0 and not done


def test_eating_grows_and_scores():
    g = make_game([(5, 5), (4, 5), (3, 5)], RIGHT, food=(6, 5))
    _, reward, done, info = g.step(STRAIGHT)
    assert reward == REWARD_FOOD and not done
    assert g.score == 1 and len(g.snake) == 4
    assert g.food not in g.body
    assert info["reason"] == "food"


def test_wall_crash():
    g = make_game([(9, 5), (8, 5), (7, 5)], RIGHT, food=(0, 0))
    _, reward, done, info = g.step(STRAIGHT)
    assert reward == REWARD_CRASH and done
    assert info == {"terminal": True, "reason": "wall"}
    assert g.end_reason == "wall"
    assert len(g.snake) == 3  # the final frame keeps the whole snake


def test_body_crash():
    # A U-shape: turning right twice runs into the body
    snake = [(5, 5), (5, 4), (4, 4), (3, 4), (3, 5), (3, 6), (4, 6), (5, 6), (6, 6)]
    g = make_game(snake, DOWN, food=(0, 0))
    # heading down from (5,5) -> (5,6) is body (not the tail)
    _, reward, done, info = g.step(STRAIGHT)
    assert done and info["reason"] == "body" and reward == REWARD_CRASH


def test_moving_into_tail_cell_is_legal():
    # A 2x2 loop: the head moves into the cell the tail is leaving
    g = make_game([(5, 5), (5, 6), (4, 6), (4, 5)], UP, food=(0, 0))
    # heading up; turn left -> LEFT, next cell (4,5) is the tail
    assert not g.is_danger((4, 5))
    _, reward, done, _ = g.step(TURN_LEFT)
    assert not done and reward == 0
    assert g.snake[0] == (4, 5)
    assert len(g.body) == len(g.snake) == 4


def test_state_danger_and_direction():
    # Snake at the right wall heading right: danger ahead only
    g = make_game([(9, 5), (8, 5), (7, 5)], RIGHT, food=(2, 2))
    s = state_dict(g)
    assert (s["danger ahead"], s["danger right"], s["danger left"]) == (1, 0, 0)
    assert (s["going right"], s["going down"], s["going left"], s["going up"]) == (1, 0, 0, 0)
    assert (s["food left"], s["food right"], s["food up"], s["food down"]) == (1, 0, 1, 0)


def test_state_danger_is_relative_to_heading():
    # Heading up along the left wall: the wall is on the snake's LEFT
    g = make_game([(0, 5), (0, 6), (0, 7)], UP, food=(5, 9))
    s = state_dict(g)
    assert (s["danger ahead"], s["danger right"], s["danger left"]) == (0, 0, 1)
    assert s["going up"] == 1
    assert (s["food left"], s["food right"], s["food up"], s["food down"]) == (0, 1, 0, 1)


def test_state_body_danger():
    # Body directly to the right of a snake heading up
    snake = [(5, 5), (5, 6), (6, 6), (6, 5), (6, 4)]
    g = make_game(snake, UP, food=(5, 0))
    s = state_dict(g)
    assert s["danger right"] == 1      # (6,5) is body
    assert s["danger ahead"] == 0      # (5,4) is free
    assert s["food up"] == 1 and s["food left"] == 0 and s["food right"] == 0


def test_food_never_on_snake():
    g = SnakeGame(6, 6, seed=3)
    for _ in range(200):
        g._place_food()
        assert g.food not in g.body


def test_timeout_is_not_terminal():
    g = SnakeGame(10, 10, seed=0, idle_limit=1)
    # circle forever: right, right, right, right... in a 2x2 square
    done, info, steps = False, {}, 0
    while not done:
        _, reward, done, info = g.step(TURN_RIGHT)
        steps += 1
        assert steps < 100
    assert info["reason"] == "timeout"
    assert info["terminal"] is False
    assert reward == 0


def test_step_after_done_raises():
    g = make_game([(9, 5), (8, 5), (7, 5)], RIGHT, food=(0, 0))
    g.step(STRAIGHT)
    with pytest.raises(RuntimeError):
        g.step(STRAIGHT)


def test_same_seed_same_game():
    a, b = SnakeGame(20, 20, seed=42), SnakeGame(20, 20, seed=42)
    rng = np.random.default_rng(0)
    for _ in range(300):
        if a.done:
            a.reset(), b.reset()
        act = int(rng.integers(3))
        sa, ra, _, _ = a.step(act)
        sb, rb, _, _ = b.step(act)
        assert np.array_equal(sa, sb) and ra == rb and a.food == b.food


def test_render_text():
    g = make_game([(2, 2), (1, 2), (0, 2)], RIGHT, food=(4, 4), size=5)
    text = g.render_text().splitlines()
    assert text[3] == "#ooO  #"
    assert text[5] == "#    *#"
