"""Build the guide in docs/ from the chapter fragments and the source annotations.

    python tools/guide/build.py            # write docs/*.html and docs/assets/source-data.js
    python tools/guide/build.py --check    # fail if anything in docs/ is out of date

Chapters live in tools/guide/chapters/NN-name.html. Each starts with a small
header, then a line with three dashes, then the body:

    title: Eleven numbers
    lede: One sentence under the title.
    meta: ENTRY 03 · snake_ai/game.py
    hint: the state
    ---
    <div class="prose measure"> ... </div>
    <figure class="fig" data-fig="inputs"> ... </figure>

The build wraps each body in the top bar, the chapter head, the pager and the
footer, so every page gets the same navigation.

Annotated source: tools/guide/annotations/<path with / replaced by __>.txt

    @title  One-line summary of the file
    @group  Group in the file list

    == text that appears on the first line of a block
    The note. Blank lines start new paragraphs. Inline `code`, **bold**, *italic*.

Anchors are matched in order and the first must match line 1, so every line is
covered by exactly one note.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DOCS = ROOT / "docs"
REPO = "https://github.com/JeyaVardhan-L/Neural-netowrk-plays-snake"
BRAND = 'Snake NN <span>/ field guide</span>'

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&amp;'
         'family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;'
         '1,8..60,400;1,8..60,500&amp;display=swap" rel="stylesheet">')
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
        "%3Crect width='16' height='16' fill='%23fafafa'/%3E%3Crect x='2' y='7' width='4' height='4' fill='%235a74ff'/%3E"
        "%3Crect x='6' y='7' width='4' height='4' fill='%235a74ff'/%3E%3Crect x='10' y='7' width='4' height='4' fill='%232b4cf2'/%3E"
        "%3Ccircle cx='12' cy='3.5' r='1.6' fill='%23111113'/%3E%3C/svg%3E")


# ---------------------------------------------------------------------- page chrome

def head(title: str, description: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description, quote=True)}">
<link rel="icon" href="{ICON}">
{FONTS}
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="topbar"><div class="topbar-inner">
<a class="brand" href="index.html">{BRAND}</a>
<nav class="nav" aria-label="Site">
<a href="index.html#contents"{{cur_contents}}>Contents</a>
<a href="source.html"{{cur_source}}>Source</a>
<a href="questions.html"{{cur_questions}}>Questions</a>
<a class="hide-sm" href="{REPO}">GitHub</a>
</nav>
</div></header>
"""


def foot(scripts: list[str]) -> str:
    tags = "\n".join(f'<script src="assets/{s}"></script>' for s in scripts)
    return f"""<div class="page"><footer class="footer">
<span>Neural network that plays Snake &middot; JeyaVardhan L &middot; MIT licence</span>
<span><a href="index.html#contents">Contents</a><a href="source.html">Source</a><a href="questions.html">Questions</a><a href="{REPO}">GitHub</a></span>
</footer></div>
{tags}
</body>
</html>
"""


def with_current(page: str, which: str) -> str:
    for name in ("contents", "source", "questions"):
        page = page.replace("{cur_" + name + "}", ' aria-current="page"' if name == which else "")
    return page


# ---------------------------------------------------------------------- chapters

def read_fragment(path: Path) -> tuple[dict, str]:
    text = path.read_text()
    header, sep, body = text.partition("\n---\n")
    if not sep:
        raise SystemExit(f"{path}: missing the '---' line after the header")
    meta = {}
    for line in header.strip().splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    for k in ("title", "lede", "meta", "hint"):
        if k not in meta:
            raise SystemExit(f"{path}: header needs '{k}:'")
    return meta, body.strip()


def chapters() -> list[dict]:
    out = []
    for path in sorted((HERE / "chapters").glob("[0-9][0-9]-*.html")):
        meta, body = read_fragment(path)
        num = path.name[:2]
        out.append({"num": num, "file": path.name[3:], "body": body, **meta})
    return out


def chapter_page(chs: list[dict], i: int) -> str:
    c = chs[i]
    prev_link = (f'<a href="{chs[i - 1]["file"]}">&larr; {chs[i - 1]["num"]} &middot; {chs[i - 1]["title"]}</a>'
                 if i > 0 else '<a href="index.html#contents">&larr; Contents</a>')
    next_link = (f'<a href="{chs[i + 1]["file"]}">{chs[i + 1]["num"]} &middot; {chs[i + 1]["title"]} &rarr;</a>'
                 if i < len(chs) - 1 else '<a href="index.html#contents">Contents &rarr;</a>')
    page = head(f'{c["title"]} · Snake NN field guide', c["lede"])
    page += f"""<main class="page">
<div class="divider first">{c["num"]} &middot; {c["title"]}</div>
<header class="chapter-head measure">
<span class="num">Chapter {c["num"]}</span>
<h2>{c["title"]}</h2>
<p class="lede">{c["lede"]}</p>
<div class="meta">{c["meta"]}</div>
</header>
{c["body"]}
<nav class="pager measure" aria-label="Chapters">{prev_link}{next_link}</nav>
</main>
"""
    page += foot(["data.js", "site.js", "figures.js"])
    return with_current(page, "")


def index_page(chs: list[dict]) -> str:
    meta, body = read_fragment(HERE / "chapters" / "index.html")
    toc = "\n".join(
        f'<li><a href="{c["file"]}"><span class="n">{c["num"]}</span>'
        f'<span class="t">{c["title"]}<small>{c["lede"]}</small></span><span class="h">{c["hint"]}</span></a></li>'
        for c in chs)
    toc += ('\n<li><a href="source.html"><span class="n">&mdash;</span><span class="t">Annotated source'
            '<small>Every line of the Python code, with a note beside each block.</small></span><span class="h">reference</span></a></li>'
            '\n<li><a href="questions.html"><span class="n">&mdash;</span><span class="t">Common questions'
            '<small>The interview questions, answered the way I would say them out loud.</small></span><span class="h">practice</span></a></li>')
    page = head(meta["title"], meta["lede"])
    page += f"""<main class="page">
{body.replace("{{TOC}}", toc)}
</main>
"""
    page += foot(["data.js", "site.js", "figures.js"])
    return with_current(page, "contents")


def special_page(name: str, scripts: list[str], current: str) -> str:
    meta, body = read_fragment(HERE / "chapters" / f"{name}.html")
    page = head(meta["title"], meta["lede"])
    page += f'<main class="page">\n{body}\n</main>\n'
    page += foot(scripts)
    return with_current(page, current)


# ---------------------------------------------------------------------- annotated source

def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])", r"<i>\1</i>", text)
    return text


def note_html(text: str) -> str:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    return "".join(f"<p>{inline(' '.join(p.split()))}</p>" for p in paras)


def parse_annotations(path: Path):
    meta, blocks = {}, []
    current = None
    for line in path.read_text().splitlines():
        if line.startswith("@") and current is None:
            k, _, v = line[1:].partition(" ")
            meta[k] = v.strip()
        elif line.startswith("== "):
            current = {"anchor": line[3:].strip(), "text": []}
            blocks.append(current)
        elif current is not None:
            current["text"].append(line)
    return meta, blocks


def source_data() -> str:
    files = []
    for ann in sorted((HERE / "annotations").glob("*.txt")):
        rel = ann.stem.replace("__", "/")
        src = ROOT / rel
        if not src.exists():
            raise SystemExit(f"{ann.name}: no such source file {rel}")
        lines = src.read_text().splitlines()
        meta, blocks = parse_annotations(ann)
        starts = []
        pos = 0
        for b in blocks:
            for i in range(pos, len(lines)):
                if b["anchor"] in lines[i]:
                    starts.append(i)
                    pos = i + 1
                    break
            else:
                raise SystemExit(f"{ann.name}: anchor not found after line {pos}: {b['anchor']!r}")
        if not starts or starts[0] != 0:
            raise SystemExit(f"{ann.name}: the first anchor must match line 1")
        out_blocks = []
        for k, b in enumerate(blocks):
            end = starts[k + 1] if k + 1 < len(starts) else len(lines)
            out_blocks.append({"start": starts[k] + 1, "end": end, "note": note_html("\n".join(b["text"]))})
        files.append({"path": rel, "title": meta.get("title", ""), "group": meta.get("group", "Other"),
                      "order": int(meta.get("order", "99")), "lines": lines, "blocks": out_blocks})
    files.sort(key=lambda f: (f["order"], f["path"]))
    body = json.dumps({"files": files}, separators=(",", ":"))
    return ("// Generated by tools/guide/build.py from the source files and tools/guide/annotations. Do not edit.\n"
            f"window.SOURCE_DATA = {body};\n")


# ---------------------------------------------------------------------- main

def outputs() -> dict[Path, str]:
    chs = chapters()
    out = {DOCS / "index.html": index_page(chs)}
    for i, c in enumerate(chs):
        out[DOCS / c["file"]] = chapter_page(chs, i)
    out[DOCS / "source.html"] = special_page("source", ["site.js", "source-data.js", "source.js"], "source")
    out[DOCS / "questions.html"] = special_page("questions", ["site.js", "questions-data.js", "questions.js"], "questions")
    out[DOCS / "assets" / "source-data.js"] = source_data()
    out[DOCS / ".nojekyll"] = ""
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if docs/ is out of date")
    args = parser.parse_args()
    out = outputs()
    stale = [p for p, text in out.items() if not p.exists() or p.read_text() != text]
    if args.check:
        if stale:
            print("out of date, run python tools/guide/build.py:")
            for p in stale:
                print("  ", p.relative_to(ROOT))
            sys.exit(1)
        print(f"docs/ is up to date ({len(out)} files)")
        return
    for p in stale:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(out[p])
    print(f"wrote {len(stale)} of {len(out)} files")


if __name__ == "__main__":
    main()
