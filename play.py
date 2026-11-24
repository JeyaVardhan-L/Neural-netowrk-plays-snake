"""Watch a trained network play Snake in the terminal, or save a GIF.

    python play.py                               # watch models/snake_q.npz play
    python play.py --model runs/main/model.npz --fps 30
    python play.py --random                      # an untrained network, for comparison
    python play.py --gif assets/demo.gif         # write a GIF instead of drawing in the terminal

Every frame shows the 11 inputs the network saw and the 3 Q-values it produced.
"""

from __future__ import annotations

import argparse
import sys
import time

import numpy as np

from snake_ai.game import ACTION_NAMES, STATE_LABELS, SnakeGame
from snake_ai.network import QNetwork

# ANSI colours for the terminal view
TEAL = "\033[38;5;43m"
RED = "\033[38;5;203m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def terminal_frame(game: SnakeGame, state, q, game_no: int) -> str:
    head = game.snake[0]
    lines = []
    lines.append(f"{BOLD}game {game_no}   score {game.score}   steps {game.steps}{RESET}")
    lines.append("+" + "--" * game.width + "+")
    for y in range(game.height):
        row = "|"
        for x in range(game.width):
            p = (x, y)
            if p == head:
                row += TEAL + "██" + RESET
            elif p in game.body:
                row += TEAL + "▓▓" + RESET
            elif p == game.food:
                row += RED + "●●" + RESET
            else:
                row += "  "
        lines.append(row + "|")
    lines.append("+" + "--" * game.width + "+")
    on = [STATE_LABELS[i] for i, v in enumerate(state) if v > 0]
    lines.append(f"{DIM}inputs on:{RESET} " + ", ".join(on))
    best = int(np.argmax(q))
    qs = "   ".join((BOLD if i == best else DIM) + f"{ACTION_NAMES[i]} {q[i]:+6.2f}" + RESET
                    for i in range(3))
    lines.append(f"{DIM}Q-values:{RESET}  {qs}")
    return "\n".join(lines)


def watch(net: QNetwork, games: int, fps: float, seed: int, board: int) -> None:
    game = SnakeGame(board, board, seed=seed)
    delay = 1.0 / fps
    sys.stdout.write("\033[2J")  # clear the screen once
    try:
        for g in range(1, games + 1):
            state = game.reset()
            while True:
                q = net.predict(state)
                sys.stdout.write("\033[H" + terminal_frame(game, state, q, g) + "\033[J")
                sys.stdout.flush()
                if game.done:
                    break
                state, _, _, _ = game.step(int(np.argmax(q)))
                time.sleep(delay)
            print(f"\n\ngame {g} over: score {game.score}, ended by {game.end_reason}")
            time.sleep(1.0)
    except KeyboardInterrupt:
        print(RESET)


def save_gif(net: QNetwork, path: str, seed: int, board: int, max_frames: int, fps: float) -> None:
    """Draw each step with Pillow and save an animated GIF."""
    from PIL import Image, ImageDraw, ImageFont

    cell = 18
    pad = 16
    panel = 250
    w = pad * 2 + board * cell + panel
    h = pad * 2 + board * cell + 30
    bg, grid, ink, muted = (250, 250, 250), (228, 228, 232), (17, 17, 19), (138, 138, 146)
    teal, teal_dark, red = (43, 196, 170), (20, 140, 120), (214, 69, 65)
    blue = (43, 76, 242)
    try:
        font = ImageFont.truetype("DejaVuSansMono.ttf", 12)
        font_b = ImageFont.truetype("DejaVuSansMono-Bold.ttf", 14)
    except OSError:
        font = font_b = ImageFont.load_default()

    game = SnakeGame(board, board, seed=seed)
    state = game.reset()
    frames = []
    while len(frames) < max_frames:
        q = net.predict(state)
        img = Image.new("RGB", (w, h), bg)
        d = ImageDraw.Draw(img)
        d.text((pad, 8), f"score {game.score}", fill=ink, font=font_b)
        ox, oy = pad, pad + 20
        d.rectangle([ox - 1, oy - 1, ox + board * cell, oy + board * cell], outline=grid)
        if game.food is not None:
            fx, fy = game.food
            d.ellipse([ox + fx * cell + 3, oy + fy * cell + 3, ox + fx * cell + cell - 3,
                       oy + fy * cell + cell - 3], fill=red)
        for i, (x, y) in enumerate(game.snake):
            d.rectangle([ox + x * cell + 1, oy + y * cell + 1, ox + x * cell + cell - 2,
                         oy + y * cell + cell - 2], fill=teal_dark if i == 0 else teal)
        # side panel: inputs and Q-values
        px = ox + board * cell + 20
        d.text((px, oy - 2), "INPUTS", fill=muted, font=font)
        for i, label in enumerate(STATE_LABELS):
            yy = oy + 16 + i * 17
            on = state[i] > 0
            d.ellipse([px, yy + 2, px + 10, yy + 12], outline=blue, fill=blue if on else bg)
            d.text((px + 16, yy), label, fill=ink if on else muted, font=font)
        qy = oy + 16 + 11 * 17 + 12
        d.text((px, qy), "Q-VALUES", fill=muted, font=font)
        best = int(np.argmax(q))
        lo, hi = min(q.min(), 0.0), max(q.max(), 1.0)
        for i in range(3):
            yy = qy + 16 + i * 18
            d.text((px, yy), f"{ACTION_NAMES[i]:>8}", fill=ink if i == best else muted, font=font)
            bar = int(110 * (q[i] - lo) / (hi - lo + 1e-9))
            d.rectangle([px + 70, yy + 3, px + 70 + max(bar, 1), yy + 11],
                        fill=blue if i == best else grid)
        frames.append(img)
        if game.done:
            for _ in range(int(fps)):  # hold the last frame for a second
                frames.append(img)
            break
        state, _, _, _ = game.step(best)

    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / fps),
                   loop=0, optimize=True)
    print(f"wrote {path}: {len(frames)} frames, final score {game.score}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="models/snake_q.npz")
    parser.add_argument("--random", action="store_true", help="use an untrained network instead")
    parser.add_argument("--games", type=int, default=3)
    parser.add_argument("--fps", type=float, default=15)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--board", type=int, default=20)
    parser.add_argument("--gif", default=None, help="write a GIF of one game to this path")
    parser.add_argument("--max-frames", type=int, default=1500)
    args = parser.parse_args()

    net = QNetwork(seed=args.seed) if args.random else QNetwork.load(args.model)
    if args.gif:
        save_gif(net, args.gif, args.seed, args.board, args.max_frames, args.fps)
    else:
        watch(net, args.games, args.fps, args.seed, args.board)


if __name__ == "__main__":
    main()
