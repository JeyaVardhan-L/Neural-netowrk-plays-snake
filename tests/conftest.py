import sys
from pathlib import Path

# Let the tests import snake_ai without installing the project.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
