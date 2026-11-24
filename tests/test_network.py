"""The network: shapes, a numerical gradient check, and the optimisers."""

import numpy as np

from snake_ai.network import SGD, Adam, QNetwork, q_loss


def loss_of(net, x, a, y):
    q, _ = net.forward(x)
    return q_loss(q, a, y)[0]


def test_shapes():
    net = QNetwork(11, 64, 3, seed=0)
    assert net.W1.shape == (11, 64) and net.b1.shape == (64,)
    assert net.W2.shape == (64, 3) and net.b2.shape == (3,)
    assert net.n_params() == 11 * 64 + 64 + 64 * 3 + 3 == 963
    assert net.predict(np.zeros(11)).shape == (3,)
    assert net.predict(np.zeros((5, 11))).shape == (5, 3)


def test_forward_matches_formula():
    net = QNetwork(4, 5, 3, seed=1)
    x = np.array([[1.0, 0.0, 1.0, 0.0]])
    h = np.maximum(0, x @ net.W1 + net.b1)
    assert np.allclose(net.predict(x), h @ net.W2 + net.b2)


def test_q_loss_only_touches_taken_action():
    q = np.array([[1.0, 2.0, 3.0], [0.0, 0.0, 0.0]])
    a = np.array([2, 0])
    y = np.array([1.0, 1.0])
    loss, dq = q_loss(q, a, y)
    # errors: 3 - 1 = 2 and 0 - 1 = -1 -> mean of squares = (4 + 1) / 2
    assert np.isclose(loss, 2.5)
    assert np.allclose(dq, [[0, 0, 2 * 2 / 2], [2 * -1 / 2, 0, 0]])


def test_gradient_check():
    """Compare backprop to finite differences on every single weight.

    If backprop has a bug, the two disagree. Relative error around 1e-7 or
    smaller means they agree.
    """
    rng = np.random.default_rng(0)
    net = QNetwork(11, 16, 3, seed=0)
    # biases start at 0, give them values so their gradients are tested properly
    net.b1[:] = rng.normal(0, 0.1, 16)
    net.b2[:] = rng.normal(0, 0.1, 3)
    x = rng.integers(0, 2, size=(8, 11)).astype(float)
    a = rng.integers(0, 3, size=8)
    y = rng.normal(0, 5, size=8)

    q, cache = net.forward(x)
    _, dq = q_loss(q, a, y)
    grads = net.backward(cache, dq)

    h = 1e-6
    for name, p in net.params.items():
        numeric = np.zeros_like(p)
        it = np.nditer(p, flags=["multi_index"])
        for _ in it:
            i = it.multi_index
            old = p[i]
            p[i] = old + h
            plus = loss_of(net, x, a, y)
            p[i] = old - h
            minus = loss_of(net, x, a, y)
            p[i] = old
            numeric[i] = (plus - minus) / (2 * h)
        rel = np.linalg.norm(numeric - grads[name]) / (np.linalg.norm(numeric) + np.linalg.norm(grads[name]) + 1e-12)
        assert rel < 1e-6, f"{name}: relative error {rel:.2e}"


def test_adam_fits_a_tiny_regression():
    """The network should be able to memorise a handful of targets."""
    rng = np.random.default_rng(0)
    net = QNetwork(11, 32, 3, seed=0)
    opt = Adam(net.params, lr=1e-2)
    x = rng.integers(0, 2, size=(16, 11)).astype(float)
    a = rng.integers(0, 3, size=16)
    y = rng.normal(0, 3, size=16)
    first = loss_of(net, x, a, y)
    for _ in range(500):
        q, cache = net.forward(x)
        _, dq = q_loss(q, a, y)
        opt.step(net.params, net.backward(cache, dq))
    assert loss_of(net, x, a, y) < first * 0.01


def test_adam_first_step_is_lr_sized():
    """After bias correction, Adam's first step is about lr * sign(grad)."""
    p = {"w": np.array([1.0, -2.0, 3.0])}
    opt = Adam(p, lr=0.1)
    opt.step(p, {"w": np.array([0.5, -100.0, 1e-3])})
    assert np.allclose(p["w"], [0.9, -1.9, 2.9], atol=1e-4)


def test_sgd_step():
    p = {"w": np.array([1.0, 2.0])}
    SGD(p, lr=0.5).step(p, {"w": np.array([2.0, -2.0])})
    assert np.allclose(p["w"], [0.0, 3.0])


def test_copy_is_independent():
    net = QNetwork(seed=0)
    other = net.copy()
    assert np.array_equal(net.W1, other.W1)
    other.W1 += 1
    assert not np.array_equal(net.W1, other.W1)


def test_save_and_load(tmp_path):
    net = QNetwork(11, 8, 3, seed=5)
    path = tmp_path / "m.npz"
    net.save(path, note="hello", games=3)
    loaded = QNetwork.load(path)
    x = np.random.default_rng(0).random((4, 11))
    assert np.allclose(net.predict(x), loaded.predict(x))
    assert QNetwork.load_metadata(path) == {"note": "hello", "games": 3}
