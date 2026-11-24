"""Snake, with no graphics.

The game is a grid of cells. The snake is a list of cells, head first. Every
step the head moves one cell in the current direction. If the new head lands on
the food the snake grows by one, otherwise the tail moves too, so the length
stays the same. Hitting a wall or the body ends the game.

The agent never sees the grid. It sees 11 numbers (see ``get_state``) and
answers with one of 3 relative moves: keep going straight, turn right, or turn
left. That keeps the problem small enough for a tiny network to learn.
"""

from __future__ import annotations

from collections import deque

import numpy as np

# Directions as (dx, dy). y grows downwards, like rows on a screen, so UP is
# (0, -1). The list is in clockwise order, which makes turning a matter of
# moving one place along the list.
RIGHT = (1, 0)
DOWN = (0, 1)
LEFT = (-1, 0)
UP = (0, -1)
CLOCKWISE = [RIGHT, DOWN, LEFT, UP]

# The three actions. They are relative to where the snake is heading, which
# means "turn right" works the same whether the snake is going up or left.
STRAIGHT = 0
TURN_RIGHT = 1
TURN_LEFT = 2
ACTION_NAMES = ["straight", "right", "left"]
N_ACTIONS = 3

# Rewards. Everything the agent learns comes from these three numbers.
REWARD_FOOD = 10.0
REWARD_CRASH = -10.0
REWARD_STEP = 0.0

STATE_LABELS = [
    "danger ahead",
    "danger right",
    "danger left",
    "going right",
    "going down",
    "going left",
    "going up",
    "food left",
    "food right",
    "food up",
    "food down",
]
STATE_SIZE = len(STATE_LABELS)


def turn(direction: tuple[int, int], action: int) -> tuple[int, int]:
    """Return the new absolute direction after a relative action."""
    i = CLOCKWISE.index(direction)
    if action == STRAIGHT:
        return direction
    if action == TURN_RIGHT:
        return CLOCKWISE[(i + 1) % 4]
    if action == TURN_LEFT:
        return CLOCKWISE[(i - 1) % 4]
    raise ValueError(f"unknown action {action!r}, expected 0, 1 or 2")


class SnakeGame:
    """One game of Snake on a ``width`` x ``height`` grid.

    ``step`` follows the usual reinforcement-learning shape: it takes an action
    and returns ``(state, reward, done, info)``.

    ``info["terminal"]`` tells a crash apart from a time-out. A crash is a real
    end of the game, so the future is worth nothing. A time-out only stops a
    snake that circles forever without eating; the game itself could have gone
    on, so the learner should not treat that state as worthless.
    """

    def __init__(self, width: int = 20, height: int = 20, seed: int | None = None,
                 idle_limit: int = 100):
        if width < 5 or height < 5:
            raise ValueError("the board must be at least 5 x 5")
        self.width = width
        self.height = height
        # A game is cut short after idle_limit * len(snake) steps without food.
        self.idle_limit = idle_limit
        self.rng = np.random.default_rng(seed)
        self.reset()

    # ------------------------------------------------------------------ setup

    def reset(self) -> np.ndarray:
        """Start a new game: a snake of length 3 in the middle, heading right."""
        cx, cy = self.width // 2, self.height // 2
        self.direction = RIGHT
        self.snake: deque[tuple[int, int]] = deque([(cx, cy), (cx - 1, cy), (cx - 2, cy)])
        self.body = set(self.snake)  # same cells as self.snake, for O(1) lookups
        self.score = 0
        self.steps = 0
        self.steps_since_food = 0
        self.done = False
        self.end_reason = ""  # "wall", "body", "timeout" or "won" once the game is over
        self.food: tuple[int, int] | None = None
        self._place_food()
        return self.get_state()

    def _place_food(self) -> None:
        """Put the food on a random free cell. No free cell means the board is full."""
        free = [(x, y) for y in range(self.height) for x in range(self.width)
                if (x, y) not in self.body]
        self.food = free[self.rng.integers(len(free))] if free else None

    # ------------------------------------------------------------------ rules

    def is_wall(self, point: tuple[int, int]) -> bool:
        x, y = point
        return not (0 <= x < self.width and 0 <= y < self.height)

    def is_danger(self, point: tuple[int, int]) -> bool:
        """Would moving the head onto ``point`` next step end the game?

        The tail is not dangerous: on the next step it moves out of the way.
        (The only time it stays is when the snake eats, and the food can never
        be on the tail.)
        """
        if self.is_wall(point):
            return True
        return point in self.body and point != self.snake[-1]

    def step(self, action: int):
        """Move one cell. Returns ``(state, reward, done, info)``."""
        if self.done:
            raise RuntimeError("the game is over, call reset() first")

        self.direction = turn(self.direction, action)
        hx, hy = self.snake[0]
        dx, dy = self.direction
        new_head = (hx + dx, hy + dy)
        self.steps += 1
        self.steps_since_food += 1

        eats = new_head == self.food

        # Move the tail first. If the head moves into the cell the tail just
        # left, that is legal, so the tail must be gone before we check.
        tail = None
        if not eats:
            tail = self.snake.pop()
            self.body.discard(tail)

        if self.is_wall(new_head) or new_head in self.body:
            if tail is not None:  # put the tail back so the final frame looks right
                self.snake.append(tail)
                self.body.add(tail)
            self.done = True
            reason = "wall" if self.is_wall(new_head) else "body"
            self.end_reason = reason
            return self.get_state(), REWARD_CRASH, True, {"terminal": True, "reason": reason}

        self.snake.appendleft(new_head)
        self.body.add(new_head)

        if eats:
            self.score += 1
            self.steps_since_food = 0
            self._place_food()
            if self.food is None:  # the snake fills the whole board
                self.done = True
                self.end_reason = "won"
                return self.get_state(), REWARD_FOOD, True, {"terminal": True, "reason": "won"}
            return self.get_state(), REWARD_FOOD, False, {"terminal": False, "reason": "food"}

        if self.steps_since_food > self.idle_limit * len(self.snake):
            self.done = True
            self.end_reason = "timeout"
            return self.get_state(), REWARD_STEP, True, {"terminal": False, "reason": "timeout"}

        return self.get_state(), REWARD_STEP, False, {"terminal": False, "reason": ""}

    # ------------------------------------------------------------------ state

    def get_state(self) -> np.ndarray:
        """The 11 numbers the network sees, each 0 or 1. Order: ``STATE_LABELS``."""
        hx, hy = self.snake[0]
        d = self.direction
        right_of = turn(d, TURN_RIGHT)
        left_of = turn(d, TURN_LEFT)

        ahead = (hx + d[0], hy + d[1])
        right = (hx + right_of[0], hy + right_of[1])
        left = (hx + left_of[0], hy + left_of[1])

        if self.food is None:
            food = (False, False, False, False)
        else:
            fx, fy = self.food
            food = (fx < hx, fx > hx, fy < hy, fy > hy)

        return np.array([
            self.is_danger(ahead),
            self.is_danger(right),
            self.is_danger(left),
            d == RIGHT,
            d == DOWN,
            d == LEFT,
            d == UP,
            *food,
        ], dtype=np.float64)

    # ------------------------------------------------------------------ display

    def render_text(self) -> str:
        """The board as text: ``#`` wall, ``O`` head, ``o`` body, ``*`` food."""
        rows = ["#" * (self.width + 2)]
        head = self.snake[0]
        for y in range(self.height):
            row = ["#"]
            for x in range(self.width):
                p = (x, y)
                if p == head:
                    row.append("O")
                elif p in self.body:
                    row.append("o")
                elif p == self.food:
                    row.append("*")
                else:
                    row.append(" ")
            row.append("#")
            rows.append("".join(row))
        rows.append("#" * (self.width + 2))
        return "\n".join(rows)
