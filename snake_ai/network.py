"""A two-layer neural network in plain NumPy: 11 inputs, 64 hidden, 3 outputs.

    h = max(0, x @ W1 + b1)      hidden layer, ReLU
    q = h @ W2 + b2              one output per action, no activation

The outputs are Q-values: the network's guess of the total future reward for
each of the three moves. They can be any real number, which is why the last
layer has no activation.

Nothing here knows about Snake. ``forward`` and ``backward`` are the whole
network, ``q_loss`` is the error we train on, and ``Adam`` turns gradients into
weight updates.
"""

from __future__ import annotations

import json

import numpy as np

PARAM_NAMES = ("W1", "b1", "W2", "b2")


class QNetwork:
    def __init__(self, n_inputs: int = 11, n_hidden: int = 64, n_outputs: int = 3,
                 seed: int | None = None):
        rng = np.random.default_rng(seed)
        # He initialisation for the ReLU layer: variance 2 / fan_in keeps the
        # size of the signal roughly the same as it passes through the layer.
        self.W1 = rng.normal(0.0, np.sqrt(2.0 / n_inputs), size=(n_inputs, n_hidden))
        self.b1 = np.zeros(n_hidden)
        # The output layer is linear, so variance 1 / fan_in (LeCun / Xavier style).
        self.W2 = rng.normal(0.0, np.sqrt(1.0 / n_hidden), size=(n_hidden, n_outputs))
        self.b2 = np.zeros(n_outputs)

    # ---------------------------------------------------------------- shapes

    @property
    def sizes(self) -> tuple[int, int, int]:
        return self.W1.shape[0], self.W1.shape[1], self.W2.shape[1]

    @property
    def params(self) -> dict[str, np.ndarray]:
        """The weight arrays themselves (not copies), keyed by name."""
        return {"W1": self.W1, "b1": self.b1, "W2": self.W2, "b2": self.b2}

    def n_params(self) -> int:
        return sum(p.size for p in self.params.values())

    # ---------------------------------------------------------------- forward

    def forward(self, x: np.ndarray):
        """Run a batch of states through the network.

        ``x`` has shape (batch, 11). Returns the Q-values, shape (batch, 3), and
        a cache of the values ``backward`` needs.
        """
        z1 = x @ self.W1 + self.b1
        h = np.maximum(0.0, z1)
        q = h @ self.W2 + self.b2
        return q, (x, h)

    def predict(self, x: np.ndarray) -> np.ndarray:
        """Q-values only. Accepts one state (11,) or a batch (n, 11)."""
        return self.forward(x)[0]

    # ---------------------------------------------------------------- backward

    def backward(self, cache, dq: np.ndarray) -> dict[str, np.ndarray]:
        """Backpropagation: from dL/dq to the gradient of every weight.

        Each line is the chain rule applied to one line of ``forward``, read
        from the bottom up.
        """
        x, h = cache
        # q = h @ W2 + b2
        dW2 = h.T @ dq
        db2 = dq.sum(axis=0)
        dh = dq @ self.W2.T
        # h = max(0, z1): the gradient passes only where the unit was on
        dz1 = dh * (h > 0)
        # z1 = x @ W1 + b1
        dW1 = x.T @ dz1
        db1 = dz1.sum(axis=0)
        return {"W1": dW1, "b1": db1, "W2": dW2, "b2": db2}

    # ---------------------------------------------------------------- copying

    def copy(self) -> "QNetwork":
        n_in, n_hidden, n_out = self.sizes
        other = QNetwork(n_in, n_hidden, n_out)
        other.load_state(self.params)
        return other

    def load_state(self, params: dict[str, np.ndarray]) -> None:
        """Overwrite this network's weights with copies of ``params``."""
        for name in PARAM_NAMES:
            getattr(self, name)[...] = params[name]

    # ---------------------------------------------------------------- saving

    def save(self, path, **metadata) -> None:
        """Save the weights to a ``.npz`` file, with optional JSON metadata."""
        np.savez(path, **self.params, metadata=json.dumps(metadata))

    @classmethod
    def load(cls, path) -> "QNetwork":
        data = np.load(path)
        n_in, n_hidden = data["W1"].shape
        n_out = data["W2"].shape[1]
        net = cls(n_in, n_hidden, n_out)
        net.load_state({name: data[name] for name in PARAM_NAMES})
        return net

    @staticmethod
    def load_metadata(path) -> dict:
        data = np.load(path)
        return json.loads(str(data["metadata"])) if "metadata" in data else {}


def q_loss(q: np.ndarray, actions: np.ndarray, targets: np.ndarray):
    """Mean squared error between Q(s, a) and the target y, for the action taken.

    We only know what happened after the move we actually made, so only that
    output gets an error. The other two outputs get a gradient of zero.

        L = mean((Q(s, a) - y)^2)      dL/dQ(s, a) = 2 (Q(s, a) - y) / n

    Returns ``(loss, dq)`` where ``dq`` has the same shape as ``q``.
    """
    n = len(actions)
    rows = np.arange(n)
    error = q[rows, actions] - targets
    loss = float(np.mean(error ** 2))
    dq = np.zeros_like(q)
    dq[rows, actions] = 2.0 * error / n
    return loss, dq


class Adam:
    """The Adam optimiser, written out.

    Plain gradient descent moves every weight by ``lr * grad``. Adam keeps two
    running averages per weight: ``m``, the average gradient (momentum), and
    ``v``, the average squared gradient (how noisy that weight is). The step is
    ``lr * m / sqrt(v)``, so each weight gets its own step size. Both averages
    start at zero, which biases them low for the first few steps; dividing by
    ``1 - beta^t`` corrects that.
    """

    def __init__(self, params: dict[str, np.ndarray], lr: float = 1e-3,
                 beta1: float = 0.9, beta2: float = 0.999, eps: float = 1e-8):
        self.lr = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self.t = 0
        self.m = {k: np.zeros_like(p) for k, p in params.items()}
        self.v = {k: np.zeros_like(p) for k, p in params.items()}

    def step(self, params: dict[str, np.ndarray], grads: dict[str, np.ndarray]) -> None:
        """Update ``params`` in place."""
        self.t += 1
        c1 = 1.0 - self.beta1 ** self.t
        c2 = 1.0 - self.beta2 ** self.t
        for k, p in params.items():
            g = grads[k]
            self.m[k] = self.beta1 * self.m[k] + (1.0 - self.beta1) * g
            self.v[k] = self.beta2 * self.v[k] + (1.0 - self.beta2) * g * g
            m_hat = self.m[k] / c1
            v_hat = self.v[k] / c2
            p -= self.lr * m_hat / (np.sqrt(v_hat) + self.eps)


class SGD:
    """Plain gradient descent, kept for comparison: ``w -= lr * grad``."""

    def __init__(self, params: dict[str, np.ndarray], lr: float = 1e-2):
        self.lr = lr

    def step(self, params: dict[str, np.ndarray], grads: dict[str, np.ndarray]) -> None:
        for k, p in params.items():
            p -= self.lr * grads[k]
