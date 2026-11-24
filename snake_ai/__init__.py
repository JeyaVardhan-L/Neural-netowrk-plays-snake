"""A neural network that learns to play Snake, written in plain NumPy."""

from .agent import Agent, Config, ReplayMemory, epsilon_for_game
from .game import ACTION_NAMES, STATE_LABELS, SnakeGame
from .network import Adam, QNetwork, q_loss

__all__ = [
    "ACTION_NAMES", "STATE_LABELS", "Adam", "Agent", "Config", "QNetwork",
    "ReplayMemory", "SnakeGame", "epsilon_for_game", "q_loss",
]
