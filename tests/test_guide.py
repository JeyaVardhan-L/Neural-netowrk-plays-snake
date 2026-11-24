"""The guide in docs/ must match the code and the trained model."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load_js(path, prefix):
    text = (ROOT / path).read_text()
    start = text.index(prefix) + len(prefix)
    return json.loads(text[start:text.rindex(";")])


def test_guide_weights_are_the_trained_model():
    data = load_js("docs/assets/data.js", "window.GUIDE_DATA = ")
    model = np.load(ROOT / "models/snake_q.npz")
    for name in ("W1", "b1", "W2", "b2"):
        assert np.array_equal(np.array(data["model"][name]), model[name]), name


def test_guide_numbers_come_from_results():
    data = load_js("docs/assets/data.js", "window.GUIDE_DATA = ")
    summary = json.loads((ROOT / "results/main/summary.json").read_text())
    assert data["main"]["eval"]["mean"] == summary["eval"]["mean"]
    experiments = json.loads((ROOT / "results/experiments/summary.json").read_text())
    assert data["experiments"]["variants"] == experiments["variants"]


def test_built_pages_are_up_to_date():
    """docs/*.html and the source reader data must be rebuilt after editing chapters or code."""
    result = subprocess.run([sys.executable, str(ROOT / "tools/guide/build.py"), "--check"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
