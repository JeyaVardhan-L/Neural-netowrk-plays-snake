// Every interactive figure in the guide. Each one is a function in `figures`,
// keyed by the data-fig attribute of a <figure class="fig">. The loader at the
// bottom finds the figures on the page and builds them.
//
// The first part is a JavaScript port of snake_ai/game.py and the forward pass
// of snake_ai/network.py. selfTest() checks the port against fixtures that the
// Python code wrote (tools/guide/export_data.py), so the snake you watch in
// the browser makes exactly the moves the Python agent would.
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var C = {
    paper: "#fafafa", card: "#ffffff", ink: "#111113", ink2: "#3b3b40", muted: "#8a8a92",
    faint: "#b9b9c0", rule: "#e4e4e8", rule2: "#efeff2", blue: "#2b4cf2", blue2: "#5a74ff",
    blueSoft: "#a9b7ff", wash: "#eef1fe", red: "#c4302b", green: "#23824a", amber: "#a86b00"
  };
  function data() { return window.GUIDE_DATA; }

  // ------------------------------------------------------------------ helpers

  function el(tag, attrs) {
    var n = document.createElement(tag);
    setAttrs(n, attrs);
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    setAttrs(n, attrs);
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function setAttrs(n, attrs) {
    if (!attrs) return;
    for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else n.setAttribute(k, v === true ? "" : v);
    }
  }
  function add(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(n, k); }); return; }
    n.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmt(x, d) { d = d === undefined ? 2 : d; return (x >= 0 ? "" : "−") + Math.abs(x).toFixed(d); }
  function fmtS(x, d) { return (x >= 0 ? "+" : "") + fmt(x, d); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  // Animate a number from `from` to `to` over ~450ms with an ease-out cubic.
  function tween(from, to, fn, ms) {
    ms = ms || 450;
    if (REDUCE) { fn(to); return; }
    var t0 = performance.now();
    function frame(now) {
      var t = clamp((now - t0) / ms, 0, 1);
      fn(from + (to - from) * ease(t));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function btn(label, onclick, attrs) {
    var b = el("button", Object.assign({ type: "button", class: "btn", text: label, onclick: onclick }, attrs || {}));
    return b;
  }
  function chip(label, onclick) { return el("button", { type: "button", class: "chip", text: label, onclick: onclick }); }
  function press(group, active) { group.forEach(function (b) { b.setAttribute("aria-pressed", b === active ? "true" : "false"); }); }

  // ← PREV  3 / 10  NEXT →
  function stepper(n, onStep, start) {
    var i = start || 0;
    var prev = btn("← Prev", function () { go(i - 1); });
    var next = btn("Next →", function () { go(i + 1); });
    var count = el("span", { class: "count" });
    function go(j) {
      i = clamp(j, 0, n - 1);
      prev.disabled = i === 0;
      next.disabled = i === n - 1;
      count.textContent = (i + 1) + " / " + n;
      onStep(i);
    }
    var node = el("div", { class: "stepper" }, prev, count, next);
    return { node: node, go: go, get i() { return i; } };
  }

  function slider(label, min, max, step, value, onInput, format) {
    var id = "s" + Math.random().toString(36).slice(2, 8);
    var input = el("input", { type: "range", id: id, min: min, max: max, step: step, value: value, "aria-label": label });
    var out = el("output", { for: id });
    function show() { out.textContent = format ? format(+input.value) : input.value; }
    input.addEventListener("input", function () { show(); onInput(+input.value); });
    show();
    return { node: el("div", { class: "slider" }, el("label", { for: id, text: label }), input, out), input: input,
      set: function (v) { input.value = v; show(); } };
  }

  function readout(tag) {
    var r = el("div", { class: "readout", "aria-live": "polite" });
    r.set = function (html, t) {
      r.innerHTML = (t || tag ? '<span class="tag">' + (t || tag) + "</span>" : "") + html;
    };
    return r;
  }

  function codeline(text) { return el("div", { class: "codeline", text: text }); }

  // Seeded random numbers, so figures look the same on every visit.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function movingAverage(xs, n) {
    var out = [], sum = 0, q = [];
    for (var i = 0; i < xs.length; i++) {
      q.push(xs[i]); sum += xs[i];
      if (q.length > n) sum -= q.shift();
      out.push(sum / q.length);
    }
    return out;
  }

  // ------------------------------------------------------------------ the game, ported from snake_ai/game.py

  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];          // RIGHT, DOWN, LEFT, UP: clockwise
  var DIR_NAMES = ["right", "down", "left", "up"];
  var ACTIONS = ["straight", "right", "left"];
  var LABELS = ["danger ahead", "danger right", "danger left", "going right", "going down", "going left",
    "going up", "food left", "food right", "food up", "food down"];

  function turn(d, a) { return a === 0 ? d : a === 1 ? (d + 1) % 4 : (d + 3) % 4; }
  function key(p) { return p[0] + "," + p[1]; }
  function same(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1]; }

  function Game(w, h, opts) {
    opts = opts || {};
    this.w = w || 20; this.h = h || 20;
    this.idle = opts.idle || 100;
    this.rand = opts.rand || Math.random;
    this.foods = opts.foods ? opts.foods.slice() : null;  // fixed food sequence (for the parity test)
    this.bugTailFirst = false;                            // the deliberate bug in FIG_004
    this.reset();
  }
  Game.prototype.reset = function () {
    var cx = Math.floor(this.w / 2), cy = Math.floor(this.h / 2);
    this.dir = 0;
    this.snake = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];
    this.body = new Set(this.snake.map(key));
    this.score = 0; this.steps = 0; this.since = 0;
    this.done = false; this.end = ""; this.crash = null;
    this.food = null;
    this.placeFood();
    return this.state();
  };
  Game.prototype.setPosition = function (snake, dir, food) {
    this.snake = snake.map(function (p) { return p.slice(); });
    this.body = new Set(this.snake.map(key));
    this.dir = dir; this.food = food ? food.slice() : null;
    this.score = 0; this.steps = 0; this.since = 0; this.done = false; this.end = ""; this.crash = null;
  };
  Game.prototype.placeFood = function () {
    if (this.foods) { this.food = this.foods.length ? this.foods.shift() : null; return; }
    var free = [];
    for (var y = 0; y < this.h; y++) for (var x = 0; x < this.w; x++) if (!this.body.has(x + "," + y)) free.push([x, y]);
    this.food = free.length ? free[Math.floor(this.rand() * free.length)] : null;
  };
  Game.prototype.isWall = function (p) { return !(p[0] >= 0 && p[0] < this.w && p[1] >= 0 && p[1] < this.h); };
  Game.prototype.isDanger = function (p) {
    if (this.isWall(p)) return true;
    return this.body.has(key(p)) && !same(p, this.snake[this.snake.length - 1]);
  };
  Game.prototype.step = function (a) {
    if (this.done) throw new Error("game over");
    this.dir = turn(this.dir, a);
    var head = this.snake[0], d = DIRS[this.dir];
    var nh = [head[0] + d[0], head[1] + d[1]];
    this.steps++; this.since++;
    var eats = same(nh, this.food);
    if (this.bugTailFirst && (this.isWall(nh) || this.body.has(key(nh)))) {
      return this._crash(nh, null);
    }
    var tail = null;
    if (!eats) { tail = this.snake.pop(); this.body.delete(key(tail)); }
    if (this.isWall(nh) || this.body.has(key(nh))) return this._crash(nh, tail);
    this.snake.unshift(nh); this.body.add(key(nh));
    if (eats) {
      this.score++; this.since = 0; this.placeFood();
      if (this.food === null) { this.done = true; this.end = "won"; return { reward: 10, done: true, terminal: true, reason: "won" }; }
      return { reward: 10, done: false, terminal: false, reason: "food" };
    }
    if (this.since > this.idle * this.snake.length) {
      this.done = true; this.end = "timeout";
      return { reward: 0, done: true, terminal: false, reason: "timeout" };
    }
    return { reward: 0, done: false, terminal: false, reason: "" };
  };
  Game.prototype._crash = function (nh, tail) {
    if (tail) { this.snake.push(tail); this.body.add(key(tail)); }
    this.done = true;
    this.end = this.isWall(nh) ? "wall" : "body";
    this.crash = nh;
    return { reward: -10, done: true, terminal: true, reason: this.end };
  };
  Game.prototype.probes = function () {
    var h = this.snake[0], out = [];
    [0, 1, 2].forEach(function (a) {
      var d = DIRS[turn(this.dir, a)];
      out.push([h[0] + d[0], h[1] + d[1]]);
    }, this);
    return out;  // ahead, right, left
  };
  Game.prototype.state = function () {
    var h = this.snake[0], p = this.probes(), f = this.food;
    return [
      +this.isDanger(p[0]), +this.isDanger(p[1]), +this.isDanger(p[2]),
      +(this.dir === 0), +(this.dir === 1), +(this.dir === 2), +(this.dir === 3),
      f ? +(f[0] < h[0]) : 0, f ? +(f[0] > h[0]) : 0, f ? +(f[1] < h[1]) : 0, f ? +(f[1] > h[1]) : 0
    ];
  };
  // How many free cells the head could still reach after playing move a (flood fill).
  // 0 means the move crashes. The network never sees this number.
  Game.prototype.spaceAfter = function (a) {
    var d = DIRS[turn(this.dir, a)], h = this.snake[0], nh = [h[0] + d[0], h[1] + d[1]], g = this;
    var body = same(nh, this.food) ? this.snake.slice() : this.snake.slice(0, -1);
    if (this.isWall(nh) || body.some(function (p) { return same(p, nh); })) return 0;
    body.unshift(nh);
    var occupied = new Set(body.map(key)), tail = key(body[body.length - 1]), seen = new Set(), stack = [];
    DIRS.forEach(function (dd) { stack.push([nh[0] + dd[0], nh[1] + dd[1]]); });
    while (stack.length) {
      var p = stack.pop(), k = key(p);
      if (seen.has(k) || g.isWall(p) || (occupied.has(k) && k !== tail)) continue;
      seen.add(k);
      DIRS.forEach(function (dd) { stack.push([p[0] + dd[0], p[1] + dd[1]]); });
    }
    return seen.size;
  };

  // ------------------------------------------------------------------ the network, ported from snake_ai/network.py

  function forward(m, x) {
    var nh = m.b1.length, no = m.b2.length, z1 = new Array(nh), h = new Array(nh), q = new Array(no), i, j;
    for (j = 0; j < nh; j++) {
      var s = m.b1[j];
      for (i = 0; i < x.length; i++) if (x[i] !== 0) s += x[i] * m.W1[i][j];
      z1[j] = s; h[j] = s > 0 ? s : 0;
    }
    for (var k = 0; k < no; k++) {
      var t = m.b2[k];
      for (j = 0; j < nh; j++) if (h[j] !== 0) t += h[j] * m.W2[j][k];
      q[k] = t;
    }
    return { z1: z1, h: h, q: q };
  }
  function argmax(v) { var b = 0; for (var i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; }

  // An untrained network, initialised the same way as QNetwork.__init__.
  function randomModel(seed, nIn, nHidden, nOut) {
    nIn = nIn || 11; nHidden = nHidden || 64; nOut = nOut || 3;
    var r = mulberry32(seed), m = { W1: [], b1: [], W2: [], b2: [] }, i, j;
    for (i = 0; i < nIn; i++) { m.W1.push([]); for (j = 0; j < nHidden; j++) m.W1[i].push(gaussian(r) * Math.sqrt(2 / nIn)); }
    for (j = 0; j < nHidden; j++) { m.b1.push(0); m.W2.push([]); for (var k = 0; k < nOut; k++) m.W2[j].push(gaussian(r) * Math.sqrt(1 / nHidden)); }
    for (k = 0; k < nOut; k++) m.b2.push(0);
    return m;
  }

  // ------------------------------------------------------------------ self-test against the Python fixtures

  function selfTest() {
    var D = data(), m = D.model, fails = [];
    D.parity.positions.forEach(function (f, n) {
      var g = new Game(20, 20);
      g.setPosition(f.snake, f.dir, f.food);
      var s = g.state();
      if (s.join() !== f.state.join()) fails.push("position " + n + ": state " + s.join("") + " != " + f.state.join(""));
      var q = forward(m, s).q;
      for (var k = 0; k < 3; k++) if (Math.abs(q[k] - f.q[k]) > 1e-9) fails.push("position " + n + ": q[" + k + "] " + q[k] + " != " + f.q[k]);
    });
    var P = D.parity.game, g = new Game(20, 20, { foods: P.foods }), s = g.state(), moves = 0;
    while (!g.done) {
      var a = argmax(forward(m, s).q);
      if (a !== P.actions[moves]) { fails.push("full game: move " + moves + " is " + a + ", python played " + P.actions[moves]); break; }
      g.step(a); s = g.state(); moves++;
    }
    if (g.score !== P.score || g.steps !== P.steps || g.end !== P.end)
      fails.push("full game: score " + g.score + "/" + P.score + ", steps " + g.steps + "/" + P.steps + ", end " + g.end + "/" + P.end);
    var result = { ok: fails.length === 0, positions: D.parity.positions.length, steps: g.steps, failures: fails };
    if (result.ok) console.info("[snake] self-test passed: " + result.positions + " positions and a " + result.steps + "-step game match the Python code");
    else console.error("[snake] self-test FAILED", fails);
    return result;
  }
  window.snakeSelfTest = selfTest;

  // ------------------------------------------------------------------ drawing a board

  function Board(w, h, cell) {
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var c = el("canvas", { class: "board", role: "img", "aria-label": "Snake board" });
    c.width = w * cell * dpr; c.height = h * cell * dpr;
    c.style.width = "100%"; c.style.maxWidth = (w * cell) + "px"; c.style.aspectRatio = w + " / " + h;
    var ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    this.canvas = c; this.w = w; this.h = h; this.cell = cell; this.ctx = ctx;
  }
  Board.prototype.cellAt = function (ev) {
    var r = this.canvas.getBoundingClientRect();
    return [Math.floor((ev.clientX - r.left) / r.width * this.w), Math.floor((ev.clientY - r.top) / r.height * this.h)];
  };
  // opts: probes (bool), crash ([x,y]), dim (bool), highlight ([[x,y],...])
  Board.prototype.draw = function (g, opts) {
    opts = opts || {};
    var ctx = this.ctx, s = this.cell, W = this.w * s, H = this.h * s, i;
    ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.rule2; ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 1; i < this.w; i++) { ctx.moveTo(i * s + .5, 0); ctx.lineTo(i * s + .5, H); }
    for (i = 1; i < this.h; i++) { ctx.moveTo(0, i * s + .5); ctx.lineTo(W, i * s + .5); }
    ctx.stroke();
    if (opts.highlight) {
      ctx.fillStyle = C.wash;
      opts.highlight.forEach(function (p) { ctx.fillRect(p[0] * s + 1, p[1] * s + 1, s - 1, s - 1); });
    }
    if (g.food) {
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.arc(g.food[0] * s + s / 2, g.food[1] * s + s / 2, s * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    var pad = Math.max(1, Math.round(s * 0.08));
    for (i = g.snake.length - 1; i >= 0; i--) {
      var p = g.snake[i];
      ctx.fillStyle = i === 0 ? C.blue : (opts.dim ? C.blueSoft : C.blue2);
      ctx.globalAlpha = i === 0 ? 1 : (opts.dim ? 0.8 : 0.85);
      ctx.fillRect(p[0] * s + pad, p[1] * s + pad, s - 2 * pad, s - 2 * pad);
    }
    ctx.globalAlpha = 1;
    // eye on the head, pointing the way it is heading
    var hd = g.snake[0], d = DIRS[g.dir];
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(hd[0] * s + s / 2 + d[0] * s * 0.18, hd[1] * s + s / 2 + d[1] * s * 0.18, Math.max(1.5, s * 0.1), 0, Math.PI * 2); ctx.fill();
    if (opts.probes && !g.done) {
      var pr = g.probes(), names = ["A", "R", "L"];
      ctx.font = "600 " + Math.round(s * 0.42) + "px JetBrains Mono, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      pr.forEach(function (q, k) {
        var danger = g.isDanger(q);
        var x = q[0] * s, y = q[1] * s;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = danger ? C.red : C.blue; ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
        ctx.setLineDash([]);
        if (q[0] >= 0 && q[0] < this.w && q[1] >= 0 && q[1] < this.h) {
          ctx.fillStyle = danger ? C.red : C.blue;
          if (!g.body.has(key(q))) ctx.fillText(names[k], x + s / 2, y + s / 2 + 1);
        }
      }, this);
    }
    if (opts.crash || g.crash) {
      var cp = opts.crash || g.crash;
      ctx.strokeStyle = C.red; ctx.lineWidth = 2.2;
      var cx = clamp(cp[0], 0, this.w - 1) * s, cy = clamp(cp[1], 0, this.h - 1) * s;
      ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx + s - 4, cy + s - 4); ctx.moveTo(cx + s - 4, cy + 4); ctx.lineTo(cx + 4, cy + s - 4); ctx.stroke();
    }
  };

  // The 11 inputs as a list of dots. onToggle(i) makes them clickable.
  function InputList(onToggle) {
    var ul = el("ul", { class: "inputs", "aria-label": "The 11 inputs" });
    var items = LABELS.map(function (label, i) {
      var li = el("li", onToggle ? { role: "button", tabindex: "0", onclick: function () { onToggle(i); },
        onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(i); } } } : null,
        el("span", { class: "dot" }), el("span", { text: label }), el("span", { class: "v", text: "0" }));
      ul.appendChild(li);
      return li;
    });
    ul.set = function (s) {
      items.forEach(function (li, i) { li.classList.toggle("on", s[i] > 0); li.lastChild.textContent = s[i] > 0 ? "1" : "0"; });
    };
    return ul;
  }

  // Three horizontal bars for the Q-values, the best one in blue.
  function QBars() {
    var wrap = el("div", { class: "qbars", "aria-label": "Q-values" });
    var rows = ACTIONS.map(function (a) {
      var bar = el("div", { class: "bar" }), zero = el("div", { class: "zero" }), val = el("span", { class: "val" });
      var row = el("div", { class: "row" }, el("span", { text: a }), el("div", { class: "track" }, bar, zero), val);
      wrap.appendChild(row);
      return { row: row, bar: bar, zero: zero, val: val };
    });
    wrap.set = function (q, lo, hi) {
      lo = Math.min(lo === undefined ? -12 : lo, Math.min.apply(null, q));
      hi = Math.max(hi === undefined ? 12 : hi, Math.max.apply(null, q));
      var best = argmax(q), span = hi - lo, z = (0 - lo) / span * 100;
      rows.forEach(function (r, k) {
        var v = (q[k] - lo) / span * 100;
        r.bar.style.left = Math.min(z, v) + "%";
        r.bar.style.width = Math.abs(v - z) + "%";
        r.zero.style.left = z + "%";
        r.val.textContent = fmtS(q[k], 2);
        r.row.classList.toggle("best", k === best);
      });
    };
    return wrap;
  }

  // ------------------------------------------------------------------ a line chart with a hover crosshair

  // opts: series [{label, values, color, dash, width, bars}], yMax, xLabel, yLabel, band {to, label},
  //       tip(i) -> html, right (px reserved for end labels)
  function lineChart(opts) {
    var W = opts.width || 960, H = opts.height || 340, L = 46, R = opts.right === undefined ? 170 : opts.right, T = 16, B = 40;
    var n = 0;
    opts.series.forEach(function (s) { n = Math.max(n, s.values.length); });
    var yMax = opts.yMax || Math.max.apply(null, opts.series.map(function (s) { return Math.max.apply(null, s.values.filter(function (v) { return v !== null; })); })) * 1.08;
    var yMin = opts.yMin || 0;
    function X(i) { return L + (i / Math.max(1, n - 1)) * (W - L - R); }
    function Y(v) { return T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B); }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria || "chart" });
    // grid and axes
    var ticks = niceTicks(yMin, yMax, 5);
    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { class: "s-grid", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.appendChild(sv("text", { class: "s-text-sm", x: L - 8, y: Y(t) + 3.5, "text-anchor": "end", text: fmtTick(t) }));
    });
    var xt = niceTicks(1, n, 8);
    xt.forEach(function (t) {
      if (t < 1 || t > n) return;
      svg.appendChild(sv("text", { class: "s-text-sm", x: X(t - 1), y: H - B + 18, "text-anchor": "middle", text: fmtTick(t) }));
    });
    svg.appendChild(sv("line", { class: "s-axis", x1: L, x2: W - R, y1: Y(yMin), y2: Y(yMin) }));
    if (opts.xLabel) svg.appendChild(sv("text", { class: "s-text-sm", x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", text: opts.xLabel }));
    if (opts.yLabel) svg.appendChild(sv("text", { class: "s-text-sm", x: 12, y: (T + H - B) / 2, "text-anchor": "middle", transform: "rotate(-90 12 " + ((T + H - B) / 2) + ")", text: opts.yLabel }));
    if (opts.band) {
      var bx = X(opts.band.to - 1);
      svg.insertBefore(sv("rect", { x: L, y: T, width: bx - L, height: H - T - B, fill: C.rule, opacity: 0.45 }), svg.firstChild);
      svg.appendChild(sv("text", { class: "s-text-sm", x: (L + bx) / 2, y: T + 16, "text-anchor": "middle", text: opts.band.label }));
    }
    var plot = sv("g");
    svg.appendChild(plot);
    var labels = sv("g");
    svg.appendChild(labels);

    function draw(series) {
      clear(plot); clear(labels);
      var ends = [];
      series.forEach(function (s) {
        if (s.hidden) return;
        if (s.bars) {
          var bw = Math.max(1, (W - L - R) / n - 0.6), path = "";
          s.values.forEach(function (v, i) { if (v > 0) path += "M" + X(i).toFixed(1) + " " + Y(0).toFixed(1) + "V" + Y(v).toFixed(1); });
          plot.appendChild(sv("path", { d: path, stroke: s.color, "stroke-width": Math.min(bw, 2.2), fill: "none", opacity: s.opacity || 0.55 }));
          return;
        }
        var d = "";
        s.values.forEach(function (v, i) { if (v !== null) d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
        plot.appendChild(sv("path", { d: d, fill: "none", stroke: s.color, "stroke-width": s.width || 1.6, "stroke-dasharray": s.dash || null, "stroke-linejoin": "round" }));
        if (s.label && R > 0) {
          var last = s.values.length - 1;
          while (last > 0 && s.values[last] === null) last--;
          ends.push({ y: Y(s.values[last]), label: s.label, color: s.labelColor || s.color });
        }
      });
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      ends.forEach(function (e) { labels.appendChild(sv("text", { class: "s-text-sm", x: W - R + 8, y: e.y + 3.5, fill: e.color, style: "fill:" + e.color, text: e.label })); });
    }
    draw(opts.series);

    // hover: crosshair and tooltip
    var wrap = el("div", { class: "chart-wrap" }, svg);
    var tip = el("div", { class: "tip", role: "status" });
    var cross = sv("line", { x1: 0, x2: 0, y1: T, y2: H - B, stroke: C.muted, "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0 });
    svg.appendChild(cross);
    wrap.appendChild(tip);
    function hover(clientX) {
      var r = svg.getBoundingClientRect(), sx = (clientX - r.left) / r.width * W;
      var i = Math.round((sx - L) / (W - L - R) * (n - 1));
      if (i < 0 || i >= n || !opts.tip) { hide(); return; }
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
      tip.innerHTML = opts.tip(i);
      tip.classList.add("show");
      var px = X(i) / W * r.width, tw = tip.offsetWidth;
      tip.style.left = clamp(px + 12, 0, r.width - tw) + "px";
      tip.style.top = "8px";
    }
    function hide() { tip.classList.remove("show"); cross.setAttribute("opacity", 0); }
    svg.addEventListener("pointermove", function (e) { hover(e.clientX); });
    svg.addEventListener("pointerdown", function (e) { hover(e.clientX); });
    svg.addEventListener("pointerleave", hide);
    return { node: wrap, draw: draw, X: X, Y: Y };
  }
  function niceTicks(lo, hi, count) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(10));
    return out;
  }
  function fmtTick(t) { return Math.abs(t) >= 1000 ? (t / 1000) + "k" : String(+t.toFixed(3)); }

  // ================================================================== figures

  var figures = {};

  // ------------------------------------------------------------------ FIG_000 hero: the trained network playing live

  figures.hero = function (body) {
    var D = data(), trained = D.model, untrained = randomModel(7), model = trained;
    var game = new Game(20, 20), board = new Board(20, 20, 20), state = game.state();
    var scores = [], best = 0, playing = !REDUCE, speed = 12, acc = 0, last = 0, pauseUntil = 0, visible = true;

    // network diagram
    var NW = 600, NH = 470, xi = 168, xh = 352, xo = 500;
    var yi = function (i) { return 26 + i * 41.5; };
    var yh = function (j) { return 12 + j * (446 / 63); };
    var yo = [136, 235, 334];
    var svg = sv("svg", { viewBox: "0 0 " + NW + " " + NH, role: "img", "aria-label": "The network: 11 inputs, 64 hidden units, 3 outputs" });
    var gIn = sv("g"), gOut = sv("g");
    svg.appendChild(gIn); svg.appendChild(gOut);
    var maxW1 = 0, maxW2 = 0;
    trained.W1.forEach(function (r) { r.forEach(function (w) { maxW1 = Math.max(maxW1, Math.abs(w)); }); });
    var e1 = [], e2 = [];
    for (var i = 0; i < 11; i++) { e1.push([]); for (var j = 0; j < 64; j++) { var ln = sv("line", { x1: xi, y1: yi(i), x2: xh, y2: yh(j), "stroke-width": 0.6, opacity: 0 }); gIn.appendChild(ln); e1[i].push(ln); } }
    for (j = 0; j < 64; j++) { e2.push([]); for (var k = 0; k < 3; k++) { var l2 = sv("line", { x1: xh, y1: yh(j), x2: xo, y2: yo[k], "stroke-width": 0.7, opacity: 0 }); gOut.appendChild(l2); e2[j].push(l2); } }
    var inNodes = LABELS.map(function (lab, i) {
      svg.appendChild(sv("text", { class: "s-text-sm", x: xi - 14, y: yi(i) + 3.5, "text-anchor": "end", text: lab }));
      var c = sv("circle", { class: "s-node", cx: xi, cy: yi(i), r: 7 });
      svg.appendChild(c);
      return c;
    });
    var hidNodes = [];
    for (j = 0; j < 64; j++) { var hc = sv("circle", { cx: xh, cy: yh(j), r: 2.6, fill: C.blue, stroke: C.blueSoft, "stroke-width": 0.6 }); svg.appendChild(hc); hidNodes.push(hc); }
    var outNodes = [], outVals = [];
    ACTIONS.forEach(function (a, k) {
      var c = sv("circle", { class: "s-node", cx: xo, cy: yo[k], r: 11 });
      svg.appendChild(c); outNodes.push(c);
      svg.appendChild(sv("text", { class: "s-text", x: xo + 20, y: yo[k] - 2, text: a }));
      var v = sv("text", { class: "s-text-sm", x: xo + 20, y: yo[k] + 13, text: "" });
      svg.appendChild(v); outVals.push(v);
    });
    svg.appendChild(sv("text", { class: "s-text-sm", x: xi, y: NH - 2, "text-anchor": "middle", text: "11 IN" }));
    svg.appendChild(sv("text", { class: "s-text-sm", x: xh, y: NH - 2, "text-anchor": "middle", text: "64 HIDDEN (RELU)" }));
    svg.appendChild(sv("text", { class: "s-text-sm", x: xo, y: NH - 2, "text-anchor": "middle", text: "3 OUT (Q)" }));

    function paintNet(s) {
      var f = forward(model, s), hmax = Math.max.apply(null, f.h) || 1, best = argmax(f.q), i, j, k;
      var mw1 = 0; model.W1.forEach(function (r) { r.forEach(function (w) { mw1 = Math.max(mw1, Math.abs(w)); }); });
      for (i = 0; i < 11; i++) {
        inNodes[i].style.fill = s[i] ? C.blue : C.card;
        for (j = 0; j < 64; j++) {
          var w = model.W1[i][j];
          e1[i][j].setAttribute("opacity", s[i] ? (0.06 + 0.42 * Math.abs(w) / mw1).toFixed(3) : 0);
          e1[i][j].setAttribute("stroke", w > 0 ? C.blue : C.faint);
        }
      }
      var cmax = 1e-9;
      for (j = 0; j < 64; j++) for (k = 0; k < 3; k++) cmax = Math.max(cmax, Math.abs(f.h[j] * model.W2[j][k]));
      for (j = 0; j < 64; j++) {
        hidNodes[j].setAttribute("opacity", f.h[j] > 0 ? (0.25 + 0.75 * f.h[j] / hmax).toFixed(3) : 0.12);
        for (k = 0; k < 3; k++) {
          var c = f.h[j] * model.W2[j][k];
          e2[j][k].setAttribute("opacity", f.h[j] > 0 ? (0.05 + 0.6 * Math.abs(c) / cmax).toFixed(3) : 0);
          e2[j][k].setAttribute("stroke", c > 0 ? C.blue : C.faint);
        }
      }
      for (k = 0; k < 3; k++) {
        outNodes[k].style.fill = k === best ? C.blue : C.card;
        outVals[k].textContent = "Q = " + fmtS(f.q[k], 2);
        outVals[k].setAttribute("style", k === best ? "fill:" + C.blue : "");
      }
      return f;
    }

    var stats = el("div", { class: "stat-row" });
    function paintStats() {
      var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : 0;
      stats.innerHTML = "score<b class=\"blue\">" + game.score + "</b> best<b>" + best + "</b> games<b>" + scores.length +
        "</b> average<b>" + (scores.length ? avg.toFixed(1) : "–") + "</b> weights<b>" + (model === trained ? "trained" : "untrained") + "</b>";
    }
    var r = readout("WHAT IT SEES");
    function paint() {
      board.draw(game, { probes: true });
      var f = paintNet(state), a = argmax(f.q);
      var on = LABELS.filter(function (_, i) { return state[i]; });
      r.set("Inputs on: <code>" + on.join("</code> <code>") + "</code>. Highest Q-value is <b>" + ACTIONS[a] +
        "</b> (" + fmtS(f.q[a], 2) + "), so that is the move.", "STEP " + game.steps);
      paintStats();
    }

    function tick() {
      if (game.done) { game.reset(); state = game.state(); return; }
      var a = argmax(forward(model, state).q);
      game.step(a);
      state = game.state();
      if (game.done) {
        scores.push(game.score); best = Math.max(best, game.score);
        pauseUntil = performance.now() + 700;
      }
    }
    function loop(now) {
      var dt = Math.min(0.25, (now - (last || now)) / 1000); last = now;
      if (playing && visible && now > pauseUntil) {
        acc += dt * speed;
        var n = 0;
        while (acc >= 1 && n < 50) { acc -= 1; n++; tick(); if (game.done) { acc = 0; break; } }
        if (n) paint();
      }
      requestAnimationFrame(loop);
    }

    var playBtn = btn(playing ? "Pause" : "Play", function () { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; });
    var stepBtn = btn("Step", function () { playing = false; playBtn.textContent = "Play"; tick(); paint(); });
    var speeds = [["1×", 6], ["2×", 12], ["8×", 48], ["40×", 240]].map(function (p) {
      var b = btn(p[0], function () { speed = p[1]; press(speeds, b); });
      return b;
    });
    press(speeds, speeds[1]);
    var modelBtns = [
      btn("Trained", function () { model = trained; press(modelBtns, modelBtns[0]); reset(); }),
      btn("Untrained", function () { model = untrained; press(modelBtns, modelBtns[1]); reset(); })
    ];
    press(modelBtns, modelBtns[0]);
    function reset() { scores = []; best = 0; game.reset(); state = game.state(); paint(); }

    var left = el("div", null, board.canvas);
    var right = el("div", null, svg);
    body.appendChild(el("div", { class: "split hero-split" }, left, right));
    body.appendChild(el("div", { class: "controls" }, playBtn, stepBtn, el("span", { class: "sep" }), speeds, el("span", { class: "sep" }), modelBtns));
    body.appendChild(el("div", { style: { marginTop: "14px" } }, stats));
    body.appendChild(r);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(body);
    paint();
    requestAnimationFrame(loop);
    setTimeout(selfTest, 0);
  };

  // ------------------------------------------------------------------ FIG_001 the loop

  figures.loop = function (body) {
    var W = 960, H = 330;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "The training loop" });
    var defs = sv("defs", null, sv("marker", { id: "arr", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" },
      sv("path", { d: "M1 1 L9 5 L1 9", fill: "none", stroke: C.blue, "stroke-width": 1.4 })));
    svg.appendChild(defs);
    var boxes = {
      game: { x: 40, y: 40, w: 150, h: 64, n: "01", t: "GAME", s: "game.py", info: "The board, the snake and the rules. <code>step(action)</code> moves the snake one cell and returns the new state, the reward and whether the game ended.", file: "snake_ai/game.py" },
      state: { x: 250, y: 40, w: 150, h: 64, n: "02", t: "11 INPUTS", s: "get_state()", info: "Eleven 0/1 numbers: danger ahead, right and left; which way the snake is heading; where the food is. That is all the network ever sees.", file: "snake_ai/game.py" },
      net: { x: 460, y: 40, w: 150, h: 64, n: "03", t: "NETWORK", s: "11 → 64 → 3", info: "Two matrix multiplications and a ReLU. Out come three Q-values: how good the network thinks straight, right and left are.", file: "snake_ai/network.py" },
      act: { x: 670, y: 40, w: 150, h: 64, n: "04", t: "PICK A MOVE", s: "epsilon-greedy", info: "Usually the move with the highest Q-value. With probability epsilon, a random move instead, so the agent keeps trying new things.", file: "snake_ai/agent.py" },
      mem: { x: 250, y: 220, w: 150, h: 64, n: "05", t: "MEMORY", s: "(s, a, r, s', end)", info: "Every step is stored as a transition. The memory holds the last 100,000 of them, and the learner samples random batches of 64.", file: "snake_ai/agent.py" },
      learn: { x: 460, y: 220, w: 150, h: 64, n: "06", t: "LEARN", s: "backprop + Adam", info: "Compute the target <code>y = r + γ max Q_target(s′, a′)</code>, the error <code>Q(s, a) − y</code>, backpropagate it and nudge the weights with Adam.", file: "snake_ai/agent.py" },
      target: { x: 670, y: 220, w: 150, h: 64, n: "07", t: "TARGET NET", s: "copy every 500", info: "A frozen copy of the network used only to compute targets. Copying it every 500 updates keeps the target from moving on every step.", file: "snake_ai/agent.py" }
    };
    function arrow(d, dashed) { return sv("path", { d: d, class: dashed ? "s-dash" : "s-line", "marker-end": "url(#arr)" }); }
    svg.appendChild(arrow("M190 72 H246"));
    svg.appendChild(arrow("M400 72 H456"));
    svg.appendChild(arrow("M610 72 H666"));
    svg.appendChild(arrow("M745 104 V150 H115 V108"));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 430, y: 144, "text-anchor": "middle", text: "ACTION: STRAIGHT / RIGHT / LEFT" }));
    svg.appendChild(arrow("M115 150 V252 H246", true));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 122, y: 200, text: "REWARD +10 / −10 / 0" }));
    svg.appendChild(arrow("M400 252 H456", true));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 428, y: 244, "text-anchor": "middle", text: "BATCH" }));
    svg.appendChild(arrow("M535 220 V108", true));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 542, y: 170, text: "NEW WEIGHTS" }));
    svg.appendChild(arrow("M666 252 H614", true));
    svg.appendChild(sv("path", { d: "M610 90 C 700 150, 700 170, 745 218", class: "s-faint" }));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 690, y: 150, text: "COPY" }));
    svg.appendChild(sv("text", { class: "s-text-sm", x: 40, y: 318, text: "SOLID: PLAYING ONE STEP      DASHED: LEARNING FROM OLD STEPS" }));

    var r = readout();
    var groups = {};
    Object.keys(boxes).forEach(function (k) {
      var b = boxes[k];
      var g = sv("g", { tabindex: "0", role: "button", "aria-label": b.t, style: "cursor:pointer" });
      var rect = sv("rect", { class: "s-box", x: b.x, y: b.y, width: b.w, height: b.h, rx: 4 });
      g.appendChild(rect);
      g.appendChild(sv("text", { class: "s-text-sm", x: b.x, y: b.y - 8, text: b.n }));
      g.appendChild(sv("text", { class: "s-text", x: b.x + b.w / 2, y: b.y + 28, "text-anchor": "middle", text: b.t }));
      g.appendChild(sv("text", { class: "s-text-sm", x: b.x + b.w / 2, y: b.y + 46, "text-anchor": "middle", text: b.s }));
      function pick() {
        Object.keys(groups).forEach(function (o) { groups[o].firstChild.setAttribute("class", o === k ? "s-box-soft" : "s-box"); });
        r.set(b.info + ' <a class="srclink" href="source.html#' + b.file + '">' + b.file + "</a>", b.n + " · " + b.t);
      }
      g.addEventListener("click", pick);
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      groups[k] = g;
      svg.appendChild(g);
    });

    // ambient motion: one dot travels the playing loop; it pauses while you hover
    var path = sv("path", { d: "M115 72 H745 V150 H115 Z", fill: "none", stroke: "none" });
    svg.appendChild(path);
    var dot = sv("circle", { r: 4.5, fill: C.blue });
    svg.appendChild(dot);
    var len = path.getTotalLength(), t = 0, hover = false, prev = 0;
    svg.addEventListener("pointerenter", function () { hover = true; });
    svg.addEventListener("pointerleave", function () { hover = false; });
    function place() { var p = path.getPointAtLength(t % len); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); }
    function anim(now) {
      if (!hover && prev) t += (now - prev) * 0.12;
      prev = now; place();
      requestAnimationFrame(anim);
    }
    place();
    if (!REDUCE) requestAnimationFrame(anim);
    body.appendChild(svg);
    body.appendChild(r);
    groups.game.dispatchEvent(new Event("click"));
  };

  // ------------------------------------------------------------------ FIG_002 the rules, playable

  figures.gamesim = function (body) {
    var N = 12, game = new Game(N, N, { rand: mulberry32(3) }), board = new Board(N, N, 30), last = null, lastSnap = null;
    var presets = {
      "start": function () { game.reset(); },
      "about to eat": function () { game.setPosition([[6, 6], [5, 6], [4, 6]], 0, [7, 6]); },
      "next to a wall": function () { game.setPosition([[11, 4], [10, 4], [9, 4]], 0, [2, 9]); },
      "chasing its tail": function () { game.setPosition([[5, 5], [5, 6], [4, 6], [4, 5]], 3, [9, 9]); }
    };
    var card = el("div", { class: "cmd" });
    var r = readout("STEP");
    var code = codeline("");
    function snap() { return { len: game.snake.length, score: game.score, steps: game.steps, since: game.since, dir: DIR_NAMES[game.dir], head: game.snake[0].join(", ") }; }
    function paintCard(now) {
      var rows = [["head", "(" + now.head + ")"], ["heading", now.dir], ["length", now.len], ["score", now.score], ["steps", now.steps], ["since food", now.since + " / limit " + (100 * now.len)]];
      var keys = ["head", "dir", "len", "score", "steps", "since"];
      card.innerHTML = "<h4>game state</h4>";
      var dl = el("dl");
      rows.forEach(function (row, i) {
        var changed = lastSnap && String(lastSnap[keys[i]]) !== String(now[keys[i]]);
        dl.appendChild(el("dt", { text: row[0] }));
        dl.appendChild(el("dd", null, el("span", { class: changed ? "changed" : "", text: String(row[1]) })));
      });
      card.appendChild(dl);
    }
    function paint() { board.draw(game, {}); paintCard(snap()); }
    function act(a) {
      if (game.done) return;
      lastSnap = snap();
      var tailBefore = game.snake[game.snake.length - 1].slice();
      last = game.step(a);
      paint();
      var moved = "Turned " + (a === 0 ? "nothing, kept going " : a === 1 ? "right, now going " : "left, now going ") + DIR_NAMES[game.dir] + ". ";
      if (last.reason === "food") { r.set(moved + "The head landed on the food: <b>+10</b>. The tail did not move, so the snake is one longer, and new food appears on a random free cell.", "REWARD +10"); code.textContent = "if eats: self.score += 1; self._place_food()   # tail was never popped"; }
      else if (last.reason === "wall") { r.set(moved + '<span class="bad">The head left the board: <b>−10</b>, game over.</span> This is a real end, so the learner will treat the future from here as worth 0.', "CRASH"); code.textContent = "if self.is_wall(new_head) or new_head in self.body:  # -> REWARD_CRASH, terminal"; }
      else if (last.reason === "body") {
        var bug = game.bugTailFirst && same(game.crash, tailBefore);
        r.set(moved + '<span class="bad">The head hit the body: <b>−10</b>, game over.</span>' + (bug ? " But look: it hit the cell the tail was about to leave. In the real game the tail moves first and this move is legal. That is the bug." : ""), "CRASH");
        code.textContent = bug ? "# BUG: checking for a collision before the tail has moved" : "if self.is_wall(new_head) or new_head in self.body:  # -> REWARD_CRASH, terminal";
      }
      else if (same(game.snake[0], tailBefore)) { r.set(moved + 'The head moved into the cell the tail just left. <span class="good">That is legal</span>: the tail is popped before the collision check.', "REWARD 0"); code.textContent = "tail = self.snake.pop(); self.body.discard(tail)   # before the check"; }
      else { r.set(moved + "Nothing happened: reward <b>0</b>. The head moved one cell and the tail followed, so the length stays " + game.snake.length + ".", "REWARD 0"); code.textContent = "self.snake.appendleft(new_head)   # and the tail was popped"; }
    }
    var acts = [btn("↑ Straight", function () { act(0); }), btn("↱ Right", function () { act(1); }), btn("↰ Left", function () { act(2); })];
    var chips = Object.keys(presets).map(function (name) {
      var c = chip(name, function () { presets[name](); lastSnap = null; press(chips, c); paint(); r.set(name === "chasing its tail" ? "The snake is in a tight 2×2 loop. Its tail is the cell to the head's left. Turn <b>left</b> into it." : "Use the buttons, or focus the board and use the arrow keys (↑ straight, → right, ← left).", "READY"); code.textContent = ""; });
      return c;
    });
    var bugBtn = btn("Bug: check before the tail moves", function () {
      game.bugTailFirst = !game.bugTailFirst;
      bugBtn.setAttribute("aria-pressed", game.bugTailFirst ? "true" : "false");
    }, { "aria-pressed": "false" });
    board.canvas.tabIndex = 0;
    board.canvas.addEventListener("keydown", function (e) {
      var m = { ArrowUp: 0, ArrowRight: 1, ArrowLeft: 2 }[e.key];
      if (m !== undefined) { e.preventDefault(); act(m); }
    });
    body.appendChild(el("div", { class: "split" }, el("div", null, board.canvas), el("div", null, card, code)));
    body.appendChild(el("div", { class: "controls" }, acts, el("span", { class: "sep" }), chips));
    body.appendChild(el("div", { class: "controls" }, bugBtn));
    body.appendChild(r);
    chips[0].click();
  };

  // ------------------------------------------------------------------ FIG_003 the 11 inputs

  figures.inputs = function (body) {
    var N = 10, game = new Game(N, N, { rand: mulberry32(11) }), board = new Board(N, N, 34);
    var presets = {
      "open board": function () { game.setPosition([[4, 5], [3, 5], [2, 5]], 0, [7, 2]); },
      "wall ahead": function () { game.setPosition([[9, 3], [8, 3], [7, 3]], 0, [2, 8]); },
      "body on the right": function () { game.setPosition([[4, 4], [4, 5], [5, 5], [5, 4], [5, 3], [5, 2]], 3, [1, 1]); },
      "boxed in": function () { game.setPosition([[3, 3], [3, 4], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [4, 5]], 3, [8, 8]); },
      "corner": function () { game.setPosition([[0, 0], [1, 0], [2, 0]], 2, [6, 6]); }
    };
    var list = InputList(null), vec = el("div", { class: "codeline" }), r = readout("READ IT AS");
    function paint() {
      board.draw(game, { probes: true });
      var s = game.state();
      list.set(s);
      vec.textContent = "x = [" + s.slice(0, 3).join(" ") + " | " + s.slice(3, 7).join(" ") + " | " + s.slice(7).join(" ") + "]";
      var dangers = ["ahead", "right", "left"].filter(function (_, i) { return s[i]; });
      var food = ["left", "right", "up", "down"].filter(function (_, i) { return s[7 + i]; });
      r.set("Heading <b>" + DIR_NAMES[game.dir] + "</b>. " + (dangers.length ? 'Danger <span class="bad">' + dangers.join(" and ") + "</span>. " : "No danger next to the head. ") +
        "Food is " + food.join(" and ") + " of the head. The dashed squares <b>A</b>, <b>R</b>, <b>L</b> are the only three cells the snake checks for danger.");
    }
    function steer(a) { if (!game.done) { game.step(a); if (game.done) game.reset(); paint(); } }
    board.canvas.addEventListener("click", function (e) {
      var p = board.cellAt(e);
      if (!game.body.has(key(p))) { game.food = p; paint(); }
    });
    var chips = Object.keys(presets).map(function (name) {
      var c = chip(name, function () { presets[name](); press(chips, c); paint(); });
      return c;
    });
    body.appendChild(el("div", { class: "split" }, el("div", null, board.canvas), el("div", null, list, vec)));
    body.appendChild(el("div", { class: "controls" }, chips));
    body.appendChild(el("div", { class: "controls" }, btn("↑ Straight", function () { steer(0); }), btn("↱ Right", function () { steer(1); }), btn("↰ Left", function () { steer(2); }),
      el("span", { class: "tag", style: { marginLeft: "8px" }, text: "Click any empty cell to move the food" })));
    body.appendChild(r);
    chips[0].click();
  };

  // ------------------------------------------------------------------ FIG_004 relative moves

  figures.relative = function (body) {
    var W = 960, H = 250, d = 0;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Relative moves" });
    var defs = sv("defs", null, sv("marker", { id: "arr2", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto" },
      sv("path", { d: "M1 1 L9 5 L1 9", fill: "none", stroke: C.blue, "stroke-width": 1.4 })));
    svg.appendChild(defs);
    var cx = 170, cy = 125, g = sv("g");
    svg.appendChild(g);
    var listG = sv("g");
    svg.appendChild(listG);
    var code = codeline(""), r = readout();
    function paint() {
      clear(g); clear(listG);
      g.appendChild(sv("rect", { class: "s-box-soft", x: cx - 18, y: cy - 18, width: 36, height: 36, rx: 3 }));
      g.appendChild(sv("text", { class: "s-text-sm", x: cx, y: cy + 4, "text-anchor": "middle", text: "HEAD" }));
      var back = DIRS[(d + 2) % 4];
      g.appendChild(sv("rect", { class: "s-box-mute", x: cx + back[0] * 44 - 16, y: cy + back[1] * 44 - 16, width: 32, height: 32, rx: 3 }));
      g.appendChild(sv("text", { class: "s-text-sm", x: cx + back[0] * 44, y: cy + back[1] * 44 + 4, "text-anchor": "middle", text: "BODY" }));
      [0, 1, 2].forEach(function (a) {
        var nd = DIRS[turn(d, a)], x2 = cx + nd[0] * 78, y2 = cy + nd[1] * 78;
        g.appendChild(sv("line", { class: "s-line", x1: cx + nd[0] * 22, y1: cy + nd[1] * 22, x2: x2, y2: y2, "marker-end": "url(#arr2)" }));
        g.appendChild(sv("text", { class: a === 0 ? "s-text-blue" : "s-text", x: cx + nd[0] * 96, y: cy + nd[1] * 96 + 4, "text-anchor": nd[0] === 0 ? "middle" : (nd[0] > 0 ? "start" : "end"), text: ACTIONS[a] }));
      });
      // the CLOCKWISE list
      listG.appendChild(sv("text", { class: "s-text-sm", x: 420, y: 60, text: "CLOCKWISE = [RIGHT, DOWN, LEFT, UP]" }));
      DIR_NAMES.forEach(function (n, i) {
        var x = 420 + i * 120, role = i === d ? "straight" : i === (d + 1) % 4 ? "right (i + 1)" : i === (d + 3) % 4 ? "left (i − 1)" : "behind (never)";
        listG.appendChild(sv("rect", { class: i === d ? "s-box-soft" : (role === "behind (never)" ? "s-box-mute" : "s-box"), x: x, y: 80, width: 104, height: 52, rx: 3 }));
        listG.appendChild(sv("text", { class: "s-text-sm", x: x + 6, y: 74, text: "[" + i + "]" }));
        listG.appendChild(sv("text", { class: "s-text", x: x + 52, y: 111, "text-anchor": "middle", text: n.toUpperCase() }));
        listG.appendChild(sv("text", { class: role === "behind (never)" ? "s-text-sm" : "s-text-blue", x: x + 52, y: 156, "text-anchor": "middle", text: role }));
      });
      listG.appendChild(sv("text", { class: "s-text-sm", x: 420, y: 205, text: "INDICES WRAP WITH % 4, SO LEFT OF RIGHT[0] IS UP[3]" }));
      code.textContent = "i = CLOCKWISE.index(" + DIR_NAMES[d].toUpperCase() + ")  # " + d + "\nright = CLOCKWISE[(" + d + " + 1) % 4]  # " + DIR_NAMES[(d + 1) % 4].toUpperCase() + "\nleft  = CLOCKWISE[(" + d + " - 1) % 4]  # " + DIR_NAMES[(d + 3) % 4].toUpperCase();
      r.set("Heading <b>" + DIR_NAMES[d] + "</b>: straight goes " + DIR_NAMES[d] + ", right goes " + DIR_NAMES[(d + 1) % 4] + ", left goes " + DIR_NAMES[(d + 3) % 4] + ". The move behind the head is never offered, so the snake can never reverse into its own neck.", "HEADING " + DIR_NAMES[d].toUpperCase());
    }
    var bs = DIR_NAMES.map(function (n, i) { var b = btn("Heading " + n, function () { d = i; press(bs, b); paint(); }); return b; });
    press(bs, bs[0]);
    body.appendChild(svg);
    body.appendChild(el("div", { class: "controls" }, bs));
    body.appendChild(code);
    body.appendChild(r);
    paint();
  };

  // ------------------------------------------------------------------ FIG_005 one neuron

  figures.neuron = function (body) {
    var x = [1, 0, 1], w = [1.5, -2.0, 0.8], b = -1.0, names = ["danger ahead", "going up", "food right"];
    var W = 960, H = 270, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "One neuron" });
    var g = sv("g"); svg.appendChild(g);
    var formula = codeline(""), r = readout("OUTPUT");
    function paint() {
      clear(g);
      var z = b, i;
      for (i = 0; i < 3; i++) z += w[i] * x[i];
      var h = Math.max(0, z), nx = 380, ny = 130;
      for (i = 0; i < 3; i++) {
        var y = 50 + i * 80;
        g.appendChild(sv("line", { x1: 150, y1: y, x2: nx - 34, y2: ny, stroke: w[i] >= 0 ? C.blue : C.faint, "stroke-width": (0.6 + 2.2 * Math.abs(w[i]) / 3).toFixed(2), opacity: x[i] ? 1 : 0.3 }));
        g.appendChild(sv("circle", { cx: 140, cy: y, r: 11, fill: x[i] ? C.blue : C.card, stroke: C.blue, "stroke-width": 1.4 }));
        g.appendChild(sv("text", { class: "s-text-sm", x: 120, y: y + 4, "text-anchor": "end", text: names[i] + " = " + x[i] }));
        g.appendChild(sv("text", { class: "s-text-blue", x: 250, y: y + (ny - y) * 0.45 - 6, "text-anchor": "middle", text: "w" + (i + 1) + " = " + fmt(w[i], 1) }));
      }
      g.appendChild(sv("circle", { class: "s-box-soft", cx: nx, cy: ny, r: 34 }));
      g.appendChild(sv("text", { class: "s-text", x: nx, y: ny - 4, "text-anchor": "middle", text: "Σ + b" }));
      g.appendChild(sv("text", { class: "s-text-sm", x: nx, y: ny + 14, "text-anchor": "middle", text: "z = " + fmt(z, 2) }));
      g.appendChild(sv("line", { class: "s-line", x1: nx + 34, y1: ny, x2: 520, y2: ny }));
      // ReLU plot
      var px = 560, py = 40, pw = 260, ph = 180, zr = 5;
      function PX(v) { return px + (v + zr) / (2 * zr) * pw; }
      function PY(v) { return py + ph - (v / zr) * ph; }
      g.appendChild(sv("rect", { class: "s-box-mute", x: px, y: py, width: pw, height: ph }));
      g.appendChild(sv("line", { class: "s-axis", x1: PX(0), x2: PX(0), y1: py, y2: py + ph }));
      g.appendChild(sv("path", { class: "s-line", d: "M" + PX(-zr) + " " + PY(0) + " L" + PX(0) + " " + PY(0) + " L" + PX(zr) + " " + PY(zr) }));
      var zc = clamp(z, -zr, zr);
      g.appendChild(sv("line", { class: "s-faint", x1: PX(zc), x2: PX(zc), y1: py + ph, y2: PY(Math.max(0, zc)) }));
      g.appendChild(sv("circle", { cx: PX(zc), cy: PY(Math.max(0, zc)), r: 5, fill: h > 0 ? C.blue : C.card, stroke: C.blue, "stroke-width": 1.4 }));
      g.appendChild(sv("text", { class: "s-text-sm", x: px, y: py - 8, text: "RELU: h = max(0, z)" }));
      g.appendChild(sv("text", { class: "s-text-sm", x: px + pw, y: py + ph + 16, "text-anchor": "end", text: "z →" }));
      g.appendChild(sv("text", { class: h > 0 ? "s-text-blue" : "s-text", x: px + pw + 16, y: ny + 4, text: "h = " + fmt(h, 2) }));
      formula.textContent = "z = " + w.map(function (wi, i) { return "(" + fmt(wi, 1) + ")(" + x[i] + ")"; }).join(" + ") + " + (" + fmt(b, 1) + ") = " + fmt(z, 2) + "     h = max(0, z) = " + fmt(h, 2);
      r.set(h > 0 ? "The weighted sum is positive, so the neuron <b>fires</b> with strength " + fmt(h, 2) + ". This number is what the next layer sees." :
        "The weighted sum is " + fmt(z, 2) + ", which is negative, so ReLU outputs <b>0</b>. The neuron is silent for this input, and (chapter 6) no gradient flows back through it either.");
    }
    var toggles = names.map(function (n, i) {
      var t = btn(n, function () { x[i] = 1 - x[i]; t.setAttribute("aria-pressed", x[i] ? "true" : "false"); paint(); }, { "aria-pressed": x[i] ? "true" : "false" });
      return t;
    });
    var sliders = [0, 1, 2].map(function (i) { return slider("weight w" + (i + 1), -3, 3, 0.1, w[i], function (v) { w[i] = v; paint(); }, function (v) { return fmt(v, 1); }); });
    var bs = slider("bias b", -3, 3, 0.1, b, function (v) { b = v; paint(); }, function (v) { return fmt(v, 1); });
    body.appendChild(svg);
    body.appendChild(el("div", { class: "controls" }, el("span", { class: "tag", text: "Inputs:" }), toggles));
    body.appendChild(el("div", { style: { marginTop: "12px" } }, sliders.map(function (s) { return s.node; }), bs.node));
    body.appendChild(formula);
    body.appendChild(r);
    paint();
  };

  // ------------------------------------------------------------------ FIG_006 forward pass playground

  figures.forward = function (body) {
    var m = data().model, s = [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0];
    var list = InputList(toggle), q = QBars(), r = readout(), shapes = codeline("");
    var grid = sv("svg", { viewBox: "0 0 260 260", role: "img", "aria-label": "64 hidden units" });
    var cells = [];
    for (var j = 0; j < 64; j++) {
      var c = sv("rect", { x: 4 + (j % 8) * 32, y: 4 + Math.floor(j / 8) * 32, width: 28, height: 28, rx: 2, fill: C.blue, stroke: C.rule, "stroke-width": 1 });
      var t = sv("title", { text: "" }); c.appendChild(t);
      grid.appendChild(c); cells.push(c);
    }
    function toggle(i) {
      if (i >= 3 && i <= 6) { for (var k = 3; k <= 6; k++) s[k] = 0; s[i] = 1; }
      else {
        s[i] = 1 - s[i];
        var pair = { 7: 8, 8: 7, 9: 10, 10: 9 }[i];
        if (pair !== undefined && s[i]) s[pair] = 0;
        if (i >= 7 && s[7] + s[8] + s[9] + s[10] === 0) s[i] = 1;  // the food is somewhere
      }
      chips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      paint();
    }
    function paint() {
      list.set(s);
      var f = forward(m, s), hmax = Math.max.apply(null, f.h) || 1, active = 0;
      f.h.forEach(function (h, j) {
        cells[j].setAttribute("fill-opacity", h > 0 ? (0.12 + 0.88 * h / hmax).toFixed(3) : 0);
        cells[j].setAttribute("fill", h > 0 ? C.blue : C.card);
        cells[j].firstChild.textContent = "unit " + j + ": z = " + f.z1[j].toFixed(3) + ", h = " + h.toFixed(3);
        if (h > 0) active++;
      });
      q.set(f.q);
      var a = argmax(f.q);
      shapes.textContent = "x (1×11) @ W1 (11×64) + b1 → z1 (1×64) → relu → h: " + active + " of 64 on\nh (1×64) @ W2 (64×3) + b2 → q (1×3) = [" + f.q.map(function (v) { return fmt(v, 2); }).join(", ") + "]";
      r.set("<b>" + active + "</b> of the 64 hidden units fire for this input. The network's choice is <b>" + ACTIONS[a] + "</b>. Q-values near +10 mean \"this leads to food soon\", values near −10 mean \"this is a crash\". Hover a square to see one unit's numbers.", "DECISION");
    }
    var scenarios = {
      "food ahead": [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
      "food up, heading right": [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0],
      "wall ahead, food left": [1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1],
      "danger ahead and right": [1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
      "food behind": [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    };
    var chips = Object.keys(scenarios).map(function (name) {
      var c = chip(name, function () { s = scenarios[name].slice(); press(chips, c); paint(); });
      return c;
    });
    body.appendChild(el("div", { class: "split" }, el("div", null, el("span", { class: "tag", text: "Click an input to flip it" }), list),
      el("div", null, el("span", { class: "tag", text: "64 hidden units (8 × 8), darker = stronger" }), grid, el("div", { style: { marginTop: "10px" } }, q))));
    body.appendChild(el("div", { class: "controls" }, chips));
    body.appendChild(shapes);
    body.appendChild(r);
    chips[1].click();
  };

  // ------------------------------------------------------------------ FIG_007 backprop, step by step, on a tiny network

  figures.backprop = function (body) {
    // 3 inputs -> 2 hidden -> 3 outputs. Small enough to show every number.
    var x = [1, 0, 1], a = 1, y = 4, lr = 0.01;
    var W1 = [[0.5, -0.4], [0.3, 0.8], [-0.2, 0.6]], b1 = [0.1, -0.5];
    var W2 = [[1.0, 2.0, -1.0], [0.5, -1.0, 1.5]], b2 = [0, 0.2, 0];
    function fwd(W1, b1, W2, b2) {
      var z1 = [0, 1].map(function (j) { return b1[j] + x[0] * W1[0][j] + x[1] * W1[1][j] + x[2] * W1[2][j]; });
      var h = z1.map(function (v) { return Math.max(0, v); });
      var q = [0, 1, 2].map(function (k) { return b2[k] + h[0] * W2[0][k] + h[1] * W2[1][k]; });
      return { z1: z1, h: h, q: q };
    }
    var f = fwd(W1, b1, W2, b2), err = f.q[a] - y, loss = err * err;
    var dq = [0, 0, 0]; dq[a] = 2 * err;
    var dW2 = [0, 1].map(function (j) { return dq.map(function (d) { return f.h[j] * d; }); });
    var dh = [0, 1].map(function (j) { return dq[0] * W2[j][0] + dq[1] * W2[j][1] + dq[2] * W2[j][2]; });
    var dz1 = dh.map(function (v, j) { return f.h[j] > 0 ? v : 0; });
    var dW1 = x.map(function (xi) { return dz1.map(function (d) { return xi * d; }); });
    var nW1 = W1.map(function (row, i) { return row.map(function (w, j) { return w - lr * dW1[i][j]; }); });
    var nb1 = b1.map(function (v, j) { return v - lr * dz1[j]; });
    var nW2 = W2.map(function (row, j) { return row.map(function (w, k) { return w - lr * dW2[j][k]; }); });
    var nb2 = b2.map(function (v, k) { return v - lr * dq[k]; });
    var f2 = fwd(nW1, nb1, nW2, nb2), loss2 = Math.pow(f2.q[a] - y, 2);
    function v(arr, d) { return "[" + arr.map(function (z) { return fmt(z, d === undefined ? 2 : d); }).join(", ") + "]"; }
    function m(mat, d) { return "[" + mat.map(function (r) { return v(r, d); }).join(", ") + "]"; }

    var steps = [
      { hl: "x", code: "x = [1, 0, 1]   # one state; a = 1 (right) was played, target y = 4", text: "Start with one remembered step: the input <code>x</code>, the move that was taken (<b>right</b>, index 1) and its target <code>y = 4</code>. The target comes from the Bellman equation in chapter 8; for now it is just the number we want Q(s, right) to be." },
      { hl: "z1", code: "z1 = x @ W1 + b1   # " + v(f.z1), text: "Forward, layer one. Each hidden unit adds up the inputs times its weights, plus its bias: <code>z1 = " + v(f.z1) + "</code>. The middle input is 0, so its weights do not matter for this example." },
      { hl: "h", code: "h = np.maximum(0, z1)   # " + v(f.h), text: "ReLU. Unit 1 is positive and passes through. Unit 2 is " + fmt(f.z1[1]) + ", so it becomes <b>0</b>. Remember that: a silent unit will also block the gradient on the way back." },
      { hl: "q", code: "q = h @ W2 + b2   # " + v(f.q), text: "Forward, layer two: three Q-values, one per move, <code>q = " + v(f.q) + "</code>. The network currently thinks <b>right</b> is worth " + fmt(f.q[a]) + "." },
      { hl: "loss", code: "loss = (q[a] - y) ** 2   # (" + fmt(f.q[a]) + " - 4)^2 = " + fmt(loss), text: "The error. Only the move we took has a target, so only <code>q[1]</code> is compared: (" + fmt(f.q[a]) + " − 4)² = <b>" + fmt(loss) + "</b>." },
      { hl: "dq", code: "dq = [0, 2 * (q[a] - y), 0]   # " + v(dq), text: "Backward starts. The derivative of (Q − y)² is 2(Q − y) = <b>" + fmt(dq[a]) + "</b>. Negative means \"Q is too small, push it up\". The other two outputs get 0: we learned nothing about them." },
      { hl: "W2", code: "dW2 = h.T @ dq   # " + m(dW2) + "\ndb2 = dq", text: "Gradient of the second weights. A weight's gradient is (what came in) × (error that came out). Only the column for <b>right</b> is non-zero, and only the row of the hidden unit that fired: " + fmt(f.h[0]) + " × " + fmt(dq[a]) + " = " + fmt(dW2[0][a]) + "." },
      { hl: "dh", code: "dh = dq @ W2.T   # " + v(dh), text: "Send the error back to the hidden layer through the same weights it came through: <code>dh = " + v(dh) + "</code>. This is the chain rule, as a matrix multiply." },
      { hl: "mask", code: "dz1 = dh * (h > 0)   # " + v(dz1), text: "Through the ReLU. Unit 2 was off, so its gradient is cut to <b>0</b>: changing its weights a little would not change the output at all. This one line is the whole derivative of ReLU." },
      { hl: "W1", code: "dW1 = x.T @ dz1   # " + m(dW1) + "\ndb1 = dz1", text: "Gradient of the first weights. Rows where the input was 0 are all zero, and so is unit 2's column. Of six weights, only two get a gradient." },
      { hl: "update", code: "W -= lr * dW   # lr = 0.01\nnew q[a] = " + fmt(f2.q[a]) + ", new loss = " + fmt(loss2), text: "Update every weight a small step against its gradient. Run the forward pass again: Q(s, right) moved from " + fmt(f.q[a]) + " to <b>" + fmt(f2.q[a]) + "</b> and the loss fell from " + fmt(loss) + " to <b>" + fmt(loss2) + "</b>. Training is this, repeated about 50,000 times." }
    ];

    var W = 960, H = 300, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "A tiny network, forward and backward" });
    var g = sv("g"); svg.appendChild(g);
    var cards = el("div", { class: "split" }), code = codeline(""), r = readout();
    var X0 = 120, X1 = 400, X2 = 680, Yx = [70, 150, 230], Yh = [105, 195], Yq = [70, 150, 230];
    function paint(i) {
      var st = steps[i], back = i >= 5;
      clear(g);
      var hl = st.hl;
      // edges
      for (var p = 0; p < 3; p++) for (var j = 0; j < 2; j++) {
        var active = (hl === "z1" || hl === "W1" || (hl === "update")) && x[p] && (hl !== "W1" || f.h[j] > 0);
        g.appendChild(sv("line", { x1: X0 + 14, y1: Yx[p], x2: X1 - 14, y2: Yh[j], class: active ? (back ? "s-dash" : "s-line") : "s-faint" }));
      }
      for (j = 0; j < 2; j++) for (var k = 0; k < 3; k++) {
        var act2 = (hl === "q" && f.h[j] > 0) || ((hl === "W2" || hl === "dh") && k === a) || (hl === "update" && k === a && f.h[j] > 0);
        g.appendChild(sv("line", { x1: X1 + 14, y1: Yh[j], x2: X2 - 14, y2: Yq[k], class: act2 ? (back ? "s-dash" : "s-line") : "s-faint" }));
      }
      // nodes and values
      x.forEach(function (xi, p) {
        g.appendChild(sv("circle", { cx: X0, cy: Yx[p], r: 13, fill: xi ? C.blue : C.card, stroke: C.blue, "stroke-width": 1.4 }));
        g.appendChild(sv("text", { class: "s-text", x: X0 - 24, y: Yx[p] + 4, "text-anchor": "end", text: "x" + p + " = " + xi }));
      });
      f.h.forEach(function (hv, j) {
        var showFwd = i >= 1, dead = hv <= 0 && i >= 2;
        g.appendChild(sv("circle", { cx: X1, cy: Yh[j], r: 15, class: (hl === "h" || hl === "mask") && !dead ? "s-box-soft" : (dead ? "s-box-mute" : "s-node") }));
        if (showFwd) g.appendChild(sv("text", { class: dead ? "s-text-sm" : "s-text", x: X1, y: Yh[j] - 24, "text-anchor": "middle", text: i >= 2 ? "h = " + fmt(hv) : "z = " + fmt(f.z1[j]) }));
        if (i >= 7) g.appendChild(sv("text", { class: i >= 8 && dead ? "s-text-red" : "s-text-blue", x: X1, y: Yh[j] + 34, "text-anchor": "middle", text: i >= 8 ? "dz = " + fmt(dz1[j]) : "dh = " + fmt(dh[j]) }));
      });
      ACTIONS.forEach(function (name, k) {
        g.appendChild(sv("circle", { cx: X2, cy: Yq[k], r: 13, class: k === a && i >= 4 ? "s-box-soft" : "s-node" }));
        g.appendChild(sv("text", { class: "s-text", x: X2 + 24, y: Yq[k] + 4, text: name + (i >= 3 ? "  q = " + fmt(i >= 10 ? f2.q[k] : f.q[k]) : "") }));
        if (i >= 5) g.appendChild(sv("text", { class: k === a ? "s-text-blue" : "s-text-sm", x: X2 + 24, y: Yq[k] + 20, text: "dq = " + fmt(dq[k]) }));
      });
      if (i >= 4) g.appendChild(sv("text", { class: "s-text-sm", x: X2 + 24, y: 285, text: "TARGET y = 4   LOSS = " + fmt(i >= 10 ? loss2 : loss) }));
      g.appendChild(sv("text", { class: "s-text-sm", x: 20, y: 22, text: back ? "BACKWARD: ERROR FLOWS RIGHT TO LEFT" : "FORWARD: VALUES FLOW LEFT TO RIGHT" }));
      code.textContent = st.code;
      r.set(st.text, "STEP " + String(i + 1).padStart(2, "0") + (back ? " · BACKWARD" : " · FORWARD"));
    }
    var stp = stepper(steps.length, paint);
    body.appendChild(svg);
    body.appendChild(el("div", { class: "controls" }, stp.node));
    body.appendChild(code);
    body.appendChild(r);
    stp.go(0);
  };

  // ------------------------------------------------------------------ FIG_008 gradient check with a bug toggle

  figures.gradcheck = function (body) {
    var rand = mulberry32(42), m = randomModel(42, 11, 8, 3), n = 6, i, j, k;
    m.b1 = m.b1.map(function () { return gaussian(rand) * 0.1; });
    m.b2 = m.b2.map(function () { return gaussian(rand) * 0.1; });
    var X = [], A = [], Y = [];
    for (i = 0; i < n; i++) { X.push([]); for (j = 0; j < 11; j++) X[i].push(rand() < 0.4 ? 1 : 0); A.push(Math.floor(rand() * 3)); Y.push(gaussian(rand) * 5); }
    function lossOf(mm) {
      var L = 0;
      for (var b = 0; b < n; b++) { var q = forward(mm, X[b]).q; L += Math.pow(q[A[b]] - Y[b], 2); }
      return L / n;
    }
    function analytic(bug) {
      var g = { W1: m.W1.map(function (r) { return r.map(function () { return 0; }); }), b1: m.b1.map(function () { return 0; }),
        W2: m.W2.map(function (r) { return r.map(function () { return 0; }); }), b2: [0, 0, 0] };
      for (var b = 0; b < n; b++) {
        var f = forward(m, X[b]), dq = [0, 0, 0];
        if (bug === "all") for (k = 0; k < 3; k++) dq[k] = 2 * (f.q[k] - Y[b]) / n;
        else dq[A[b]] = (bug === "two" ? 1 : 2) * (f.q[A[b]] - Y[b]) / n;
        for (j = 0; j < 8; j++) for (k = 0; k < 3; k++) g.W2[j][k] += f.h[j] * dq[k];
        for (k = 0; k < 3; k++) g.b2[k] += dq[k];
        for (j = 0; j < 8; j++) {
          var dh = 0;
          for (k = 0; k < 3; k++) dh += dq[k] * m.W2[j][k];
          var dz = bug === "mask" ? dh : (f.h[j] > 0 ? dh : 0);
          g.b1[j] += dz;
          for (i = 0; i < 11; i++) g.W1[i][j] += X[b][i] * dz;
        }
      }
      return g;
    }
    function numeric() {
      var h = 1e-5, g = {};
      ["W1", "b1", "W2", "b2"].forEach(function (name) {
        var p = m[name];
        if (Array.isArray(p[0])) g[name] = p.map(function (row, a) { return row.map(function (_, b) { var o = p[a][b]; p[a][b] = o + h; var up = lossOf(m); p[a][b] = o - h; var dn = lossOf(m); p[a][b] = o; return (up - dn) / (2 * h); }); });
        else g[name] = p.map(function (_, a) { var o = p[a]; p[a] = o + h; var up = lossOf(m); p[a] = o - h; var dn = lossOf(m); p[a] = o; return (up - dn) / (2 * h); });
      });
      return g;
    }
    function flat(x) { return Array.isArray(x[0]) ? [].concat.apply([], x) : x; }
    function relErr(a, b) {
      a = flat(a); b = flat(b);
      var d = 0, na = 0, nb = 0;
      for (var t = 0; t < a.length; t++) { d += Math.pow(a[t] - b[t], 2); na += a[t] * a[t]; nb += b[t] * b[t]; }
      return Math.sqrt(d) / (Math.sqrt(na) + Math.sqrt(nb) + 1e-12);
    }
    var num = numeric();
    var table = el("div"), r = readout(), code = codeline("");
    var bugs = {
      none: ["Correct backprop", "dz1 = dh * (h > 0)"],
      mask: ["Bug: drop the ReLU mask", "dz1 = dh                # forgot * (h > 0)"],
      all: ["Bug: error on all 3 outputs", "dq = 2 * (q - y[:, None]) / n   # every output, not just the action taken"],
      two: ["Bug: forget the 2", "dq[rows, a] = (q[rows, a] - y) / n   # d/dQ of (Q - y)^2 is 2(Q - y)"]
    };
    function paint(bug) {
      var g = analytic(bug);
      clear(table);
      var t = el("table", { class: "ptable", style: { cursor: "default" } });
      t.appendChild(el("tr", null, el("th", { text: "parameter" }), el("th", { text: "shape" }), el("th", { text: "relative error" }), el("th", { text: "verdict" })));
      var worst = 0;
      ["W1", "b1", "W2", "b2"].forEach(function (name) {
        var e = relErr(g[name], num[name]);
        worst = Math.max(worst, e);
        var ok = e < 1e-6;
        var shape = Array.isArray(m[name][0]) ? m[name].length + " × " + m[name][0].length : String(m[name].length);
        t.appendChild(el("tr", null, el("td", { text: name }), el("td", { text: shape }), el("td", { text: e.toExponential(2) }),
          el("td", { style: { color: ok ? C.green : C.red }, text: ok ? "matches" : "WRONG" })));
      });
      table.appendChild(t);
      code.textContent = bugs[bug][1];
      r.set(bug === "none" ? '<span class="good">Every parameter agrees with finite differences to about 1e-10.</span> Finite differences nudge one weight by ±1e-5 and measure how the loss changes. That is slow (two forward passes per weight) but almost impossible to get wrong, which makes it the perfect referee for backprop.' :
        '<span class="bad">The check catches it.</span> Worst relative error ' + worst.toExponential(1) + ". " + (bug === "mask" ? "Only the layer below the ReLU is wrong: W2 and b2 still match, which tells you exactly where to look." : bug === "two" ? "Every gradient is exactly half the true one. Training would still work, just as if the learning rate were halved, which is why this kind of bug can hide for weeks." : "The extra error on actions that were not taken pushes those Q-values towards a target that was never meant for them."), "MAX ERROR " + worst.toExponential(1));
    }
    var bs = Object.keys(bugs).map(function (b) { var x = btn(bugs[b][0], function () { press(bs, x); paint(b); }); return x; });
    body.appendChild(el("div", { class: "controls", style: { marginTop: 0 } }, bs));
    body.appendChild(el("div", { style: { marginTop: "14px" } }, table));
    body.appendChild(code);
    body.appendChild(r);
    bs[0].click();
  };

  // ------------------------------------------------------------------ FIG_009 gradient descent vs Adam

  figures.optim = function (body) {
    var A = 1, B = 14, start = [-4.2, 1.6], lr = 0.11, steps = 40;
    function grad(p) { return [A * p[0], B * p[1]]; }
    function loss(p) { return 0.5 * (A * p[0] * p[0] + B * p[1] * p[1]); }
    function runSGD() { var p = start.slice(), path = [p.slice()]; for (var t = 0; t < steps; t++) { var g = grad(p); p = [p[0] - lr * g[0], p[1] - lr * g[1]]; path.push(p.slice()); } return path; }
    function runAdam() {
      var p = start.slice(), m = [0, 0], v = [0, 0], path = [p.slice()], b1 = 0.9, b2 = 0.999;
      for (var t = 1; t <= steps; t++) {
        var g = grad(p);
        for (var i = 0; i < 2; i++) {
          m[i] = b1 * m[i] + (1 - b1) * g[i]; v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
          p[i] -= lr * (m[i] / (1 - Math.pow(b1, t))) / (Math.sqrt(v[i] / (1 - Math.pow(b2, t))) + 1e-8);
        }
        path.push(p.slice());
      }
      return path;
    }
    var W = 960, H = 340, sx = 90, sy = 85;
    function PX(x) { return W / 2 + x * sx; }
    function PY(y) { return H / 2 - y * sy; }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Two optimisers on a long narrow valley" });
    [0.5, 2, 5, 9, 14, 20].forEach(function (c) {
      svg.appendChild(sv("ellipse", { cx: PX(0), cy: PY(0), rx: Math.sqrt(2 * c / A) * sx, ry: Math.sqrt(2 * c / B) * sy, fill: "none", stroke: C.blueSoft, "stroke-width": 0.8, opacity: 0.7 }));
    });
    svg.appendChild(sv("circle", { cx: PX(0), cy: PY(0), r: 3, fill: C.ink }));
    svg.appendChild(sv("text", { class: "s-text-sm", x: PX(0) + 8, y: PY(0) - 8, text: "MINIMUM" }));
    var gS = sv("g"), gA = sv("g");
    svg.appendChild(gS); svg.appendChild(gA);
    svg.appendChild(sv("text", { class: "s-text-sm", x: 16, y: 20, text: "LOSS = ½(w₁² + 14·w₂²): STEEP IN ONE DIRECTION, SHALLOW IN THE OTHER" }));
    var r = readout(), formula = codeline("");
    function drawPath(g, path, color, dash) {
      clear(g);
      var d = path.map(function (p, i) { return (i ? "L" : "M") + PX(clamp(p[0], -6, 6)).toFixed(1) + " " + PY(clamp(p[1], -2.4, 2.4)).toFixed(1); }).join("");
      g.appendChild(sv("path", { d: d, fill: "none", stroke: color, "stroke-width": 1.6, "stroke-dasharray": dash || null }));
      path.forEach(function (p, i) { if (i % 2 === 0 || i === path.length - 1) g.appendChild(sv("circle", { cx: PX(clamp(p[0], -6, 6)), cy: PY(clamp(p[1], -2.4, 2.4)), r: i === path.length - 1 ? 4.5 : 2.2, fill: color })); });
    }
    function paint() {
      var s = runSGD(), a = runAdam(), ls = loss(s[s.length - 1]), la = loss(a[a.length - 1]);
      drawPath(gS, s, C.muted, "4 3");
      drawPath(gA, a, C.blue);
      var diverged = !isFinite(ls) || ls > loss(start);
      formula.textContent = "gradient descent:  w ← w − " + lr.toFixed(3) + " · g\nAdam:              w ← w − " + lr.toFixed(3) + " · m̂ / (√v̂ + ε)    m = avg of g,  v = avg of g²";
      r.set("After " + steps + " steps the loss is <b>" + (isFinite(ls) ? ls.toExponential(2) : "∞") + "</b> for gradient descent (grey, dashed) and <b>" + la.toExponential(2) + "</b> for Adam (blue). " +
        (diverged ? '<span class="bad">Gradient descent blew up:</span> the steep direction has curvature 14, so any learning rate above 2/14 = 0.143 overshoots further every step.' :
          lr * B > 1 ? "Gradient descent zig-zags across the steep direction because the step is too big there, and crawls along the shallow one. One learning rate cannot suit both." :
            "Gradient descent is stable but slow along the shallow direction. Adam divides each step by the size of recent gradients, so both directions move at about the same speed."), "AFTER " + steps + " STEPS");
    }
    var s1 = slider("learning rate", 0.01, 0.2, 0.005, lr, function (v) { lr = v; paint(); }, function (v) { return v.toFixed(3); });
    var s2 = slider("steps", 1, 80, 1, steps, function (v) { steps = v; paint(); });
    body.appendChild(svg);
    body.appendChild(el("div", { style: { marginTop: "8px" } }, s1.node, s2.node));
    body.appendChild(el("div", { class: "controls" }, chip("lr 0.05", function () { lr = 0.05; s1.set(lr); paint(); }), chip("lr 0.11", function () { lr = 0.11; s1.set(lr); paint(); }), chip("lr 0.15 (too big)", function () { lr = 0.15; s1.set(lr); paint(); })));
    body.appendChild(formula);
    body.appendChild(r);
    paint();
  };

  // ------------------------------------------------------------------ FIG_010 Q-learning in a corridor

  figures.corridor = function (body) {
    // cells 1..5 are walkable; moving left from 1 hits the wall (-10, end); moving right from 5 eats the food (+10, end)
    var N = 5, gamma = 0.9, Q, sweeps, sel = 1;
    function reset() { Q = []; for (var s = 0; s <= N; s++) Q.push([0, 0]); sweeps = 0; }
    function outcome(s, a) {  // a: 0 = left, 1 = right
      if (a === 0 && s === 1) return { r: -10, next: null };
      if (a === 1 && s === N) return { r: 10, next: null };
      return { r: 0, next: a === 0 ? s - 1 : s + 1 };
    }
    function target(s, a, Qold) {
      var o = outcome(s, a);
      return o.r + (o.next === null ? 0 : gamma * Math.max(Qold[o.next][0], Qold[o.next][1]));
    }
    function sweep() {
      var old = Q.map(function (r) { return r.slice(); });
      for (var s = 1; s <= N; s++) for (var a = 0; a < 2; a++) Q[s][a] = target(s, a, old);
      sweeps++;
    }
    var W = 960, H = 250, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "A one-dimensional world" });
    var g = sv("g"); svg.appendChild(g);
    var r = readout(), code = codeline("");
    function paint() {
      clear(g);
      var cw = 120, x0 = 140, y0 = 60;
      g.appendChild(sv("rect", { x: x0 - 40, y: y0, width: 36, height: 80, fill: C.rule, stroke: C.faint }));
      g.appendChild(sv("text", { class: "s-text-sm", x: x0 - 22, y: y0 + 100, "text-anchor": "middle", text: "WALL" }));
      g.appendChild(sv("text", { class: "s-text-red", x: x0 - 22, y: y0 - 10, "text-anchor": "middle", text: "−10" }));
      for (var s = 1; s <= N; s++) {
        var x = x0 + (s - 1) * cw;
        var best = Q[s][1] > Q[s][0] ? 1 : Q[s][0] > Q[s][1] ? 0 : -1;
        var grp = sv("g", { tabindex: "0", role: "button", "aria-label": "cell " + s, style: "cursor:pointer" });
        grp.appendChild(sv("rect", { class: s === sel ? "s-box-soft" : "s-box", x: x, y: y0, width: cw - 8, height: 80, rx: 3 }));
        grp.appendChild(sv("text", { class: "s-text-sm", x: x + 4, y: y0 - 8, text: "CELL " + s }));
        grp.appendChild(sv("text", { class: best === 0 ? "s-text-blue" : "s-text", x: x + 10, y: y0 + 34, text: "← " + fmt(Q[s][0], 2) }));
        grp.appendChild(sv("text", { class: best === 1 ? "s-text-blue" : "s-text", x: x + 10, y: y0 + 60, text: "→ " + fmt(Q[s][1], 2) }));
        (function (s) {
          grp.addEventListener("click", function () { sel = s; paint(); });
          grp.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sel = s; paint(); } });
        })(s);
        g.appendChild(grp);
      }
      var fx = x0 + N * cw;
      g.appendChild(sv("circle", { cx: fx + 20, cy: y0 + 40, r: 12, fill: C.ink }));
      g.appendChild(sv("text", { class: "s-text-sm", x: fx + 20, y: y0 + 100, "text-anchor": "middle", text: "FOOD" }));
      g.appendChild(sv("text", { class: "s-text-blue", x: fx + 20, y: y0 - 10, "text-anchor": "middle", text: "+10" }));
      g.appendChild(sv("text", { class: "s-text-sm", x: 16, y: 210, text: "EACH CELL SHOWS Q(cell, ←) AND Q(cell, →). BLUE = THE MOVE A GREEDY AGENT WOULD PICK." }));
      g.appendChild(sv("text", { class: "s-text-sm", x: 16, y: 230, text: "SWEEPS SO FAR: " + sweeps + "    GAMMA: " + gamma.toFixed(2) }));
      var o = outcome(sel, 1), nxt = o.next;
      code.textContent = "Q(" + sel + ", →) ← r + γ · max Q(next) = " + fmt(o.r, 0) + (nxt === null ? "  (game over, no future)" : " + " + gamma.toFixed(2) + " × " + fmt(Math.max(Q[nxt][0], Q[nxt][1]), 2) + "   (next = cell " + nxt + ")");
      var allRight = true;
      for (var c = 1; c <= N; c++) if (!(Q[c][1] > Q[c][0])) allRight = false;
      r.set(sweeps === 0 ? "Everything starts at 0: the agent knows nothing. Press <b>Sweep</b> to apply the Bellman update to every cell once." :
        allRight ? "Every cell now prefers <b>→</b>. The +10 at the end has travelled back one cell per sweep, shrinking by γ each time: cell 1 is worth " + fmt(Q[1][1], 2) + ". The agent learned a 5-step plan from a reward it only sees at the very end." :
          gamma === 0 ? 'With γ = 0 only the reward of the very next step counts. Cell 5 learns → is good, but cells 1 to 4 see 0 either way, and cell 1 only learns to avoid the wall. <span class="warn">No plan forms.</span> This is exactly what happened to the snake with gamma 0 in chapter 12.' :
            "After " + sweeps + " sweep" + (sweeps > 1 ? "s" : "") + ", the reward has reached " + Math.min(sweeps, N) + " cell" + (sweeps > 1 ? "s" : "") + " back from the food. Click a cell to see its update with the numbers filled in.", "BELLMAN UPDATE");
    }
    var gs = slider("discount γ", 0, 0.99, 0.01, gamma, function (v) { gamma = v; reset(); paint(); }, function (v) { return v.toFixed(2); });
    body.appendChild(svg);
    body.appendChild(el("div", { class: "controls" }, btn("Sweep", function () { sweep(); paint(); }), btn("Sweep ×10", function () { for (var i = 0; i < 10; i++) sweep(); paint(); }), btn("Reset", function () { reset(); paint(); }),
      el("span", { class: "sep" }), chip("γ = 0", function () { gamma = 0; gs.set(0); reset(); paint(); }), chip("γ = 0.5", function () { gamma = 0.5; gs.set(0.5); reset(); paint(); }), chip("γ = 0.9", function () { gamma = 0.9; gs.set(0.9); reset(); paint(); })));
    body.appendChild(el("div", { style: { marginTop: "8px" } }, gs.node));
    body.appendChild(code);
    body.appendChild(r);
    reset(); paint();
  };

  // ------------------------------------------------------------------ FIG_011 the epsilon schedule

  figures.epsilon = function (body) {
    var decay = 150, end = 0.01, games = 400;
    var W = 960, H = 260, L = 46, R = 20, T = 16, B = 36;
    function X(gm) { return L + gm / games * (W - L - R); }
    function Y(e) { return T + (1 - e) * (H - T - B); }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Epsilon over training" });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      svg.appendChild(sv("line", { class: "s-grid", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.appendChild(sv("text", { class: "s-text-sm", x: L - 8, y: Y(t) + 3.5, "text-anchor": "end", text: String(t) }));
    });
    [0, 100, 200, 300, 400].forEach(function (t) { svg.appendChild(sv("text", { class: "s-text-sm", x: X(t), y: H - B + 18, "text-anchor": "middle", text: String(t) })); });
    svg.appendChild(sv("text", { class: "s-text-sm", x: (W) / 2, y: H - 4, "text-anchor": "middle", text: "game" }));
    var area = sv("path", { fill: C.wash, stroke: "none" }), line = sv("path", { class: "s-line", "stroke-width": 2 });
    svg.appendChild(area); svg.appendChild(line);
    var r = readout(), code = codeline("");
    function eps(gm) { if (decay <= 0) return end; var f = Math.min(1, gm / decay); return 1 + f * (end - 1); }
    function paint() {
      var d = "";
      for (var gm = 0; gm <= games; gm += 2) d += (d ? "L" : "M") + X(gm).toFixed(1) + " " + Y(eps(gm)).toFixed(1);
      line.setAttribute("d", d);
      area.setAttribute("d", d + "L" + X(games) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z");
      code.textContent = "epsilon(game) = 1.0 + min(1, game / " + decay + ") × (" + end + " − 1.0)";
      var exps = data().experiments.variants, nearest = decay === 0 ? "eps_none" : decay <= 100 ? "eps_50" : decay <= 225 ? "baseline" : "eps_300";
      var v = exps[nearest];
      r.set("At game 50 the snake moves at random <b>" + Math.round(eps(50) * 100) + "%</b> of the time; at game 200, <b>" + (eps(200) * 100).toFixed(1) + "%</b>. The closest schedule I actually trained (5 seeds) scored <b>" + v.eval_mean.toFixed(1) + " ± " + v.eval_std.toFixed(1) + "</b> in greedy evaluation.", "DECAY OVER " + decay + " GAMES");
    }
    var s1 = slider("decay over (games)", 0, 400, 10, decay, function (v) { decay = v; paint(); });
    var s2 = slider("floor eps_end", 0, 0.2, 0.01, end, function (v) { end = v; paint(); }, function (v) { return v.toFixed(2); });
    body.appendChild(svg);
    body.appendChild(el("div", { style: { marginTop: "8px" } }, s1.node, s2.node));
    body.appendChild(code);
    body.appendChild(r);
    paint();
  };

  // ------------------------------------------------------------------ FIG_012 replay memory as a ring buffer

  figures.replay = function (body) {
    var CAP = 10, slots = [], pos = 0, t = 0, picked = [], rand = mulberry32(5), lastWrite = -1;
    var W = 960, H = 200, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Replay memory" });
    var g = sv("g"); svg.appendChild(g);
    var r = readout(), code = codeline("");
    var kinds = ["r = 0", "r = 0", "r = 0", "r = +10", "r = 0", "r = 0", "r = −10"];
    function paint() {
      clear(g);
      var w = 84, x0 = 40;
      for (var i = 0; i < CAP; i++) {
        var x = x0 + i * (w + 4), s = slots[i];
        var cls = picked.indexOf(i) >= 0 ? "s-box-soft" : s ? "s-box" : "s-box-mute";
        g.appendChild(sv("rect", { class: cls, x: x, y: 60, width: w, height: 62, rx: 3 }));
        g.appendChild(sv("text", { class: "s-text-sm", x: x + 4, y: 54, text: "[" + i + "]" }));
        if (s) {
          g.appendChild(sv("text", { class: i === lastWrite ? "s-text-blue" : "s-text", x: x + w / 2, y: 86, "text-anchor": "middle", text: "step " + s.t }));
          g.appendChild(sv("text", { class: s.k.indexOf("−10") >= 0 ? "s-text-red" : "s-text-sm", x: x + w / 2, y: 106, "text-anchor": "middle", text: s.k }));
        }
      }
      var px = x0 + pos * (w + 4) + w / 2;
      g.appendChild(sv("path", { class: "s-line", d: "M" + px + " 150 V128" }));
      g.appendChild(sv("path", { d: "M" + (px - 5) + " 134 L" + px + " 127 L" + (px + 5) + " 134", fill: "none", stroke: C.blue, "stroke-width": 1.4 }));
      g.appendChild(sv("text", { class: "s-text-blue", x: px, y: 168, "text-anchor": "middle", text: "pos = " + pos }));
      g.appendChild(sv("text", { class: "s-text-sm", x: 40, y: 22, text: "CAPACITY " + CAP + " HERE (100,000 IN THE REAL RUN)    FILLED: " + slots.filter(Boolean).length + "    BATCH: 4 (64 IN THE REAL RUN)" }));
    }
    function push() {
      t++;
      var over = slots[pos];
      slots[pos] = { t: t, k: kinds[(t - 1) % kinds.length] };
      lastWrite = pos; picked = [];
      code.textContent = "self.states[" + pos + "] = state; ...\nself.pos = (" + pos + " + 1) % " + CAP + "   # = " + ((pos + 1) % CAP);
      r.set(over ? '<span class="warn">Memory is full</span>, so step ' + t + " overwrote step " + over.t + ", the oldest one. A ring buffer never grows and never needs to shift anything." : "Step " + t + " stored in slot " + pos + ". The pointer moves on.", "PUSH");
      pos = (pos + 1) % CAP;
      paint();
    }
    function sample() {
      var filled = slots.filter(Boolean).length;
      if (!filled) { r.set("Nothing to sample yet. Push some steps first.", "SAMPLE"); return; }
      picked = []; for (var i = 0; i < 4; i++) picked.push(Math.floor(rand() * filled));
      lastWrite = -1;
      code.textContent = "idx = rng.integers(0, " + filled + ", size=4)   # " + JSON.stringify(picked);
      r.set("A random batch: slots " + picked.join(", ") + " (repeats are allowed). Those steps come from different moments and often different games, so the batch is not dominated by one corridor or one turn. That is the point: consecutive steps are highly correlated, and training on them in order makes the network chase whatever it saw last.", "SAMPLE");
      paint();
    }
    body.appendChild(svg);
    body.appendChild(el("div", { class: "controls" }, btn("Play one step (push)", push), btn("Play 5 steps", function () { for (var i = 0; i < 5; i++) push(); }), btn("Sample a batch", sample),
      btn("Reset", function () { slots = []; pos = 0; t = 0; picked = []; lastWrite = -1; code.textContent = ""; r.set("Empty memory.", "RESET"); paint(); })));
    body.appendChild(code);
    body.appendChild(r);
    r.set("Press <b>Play one step</b> to store a transition (state, action, reward, next state, terminal).", "EMPTY");
    paint();
  };

  // ------------------------------------------------------------------ learning curves from the experiments (several figures)

  function curvesFigure(body, groupKey, intro) {
    var E = data().experiments, rows = E.groups[groupKey];
    var styles = [{ dash: null, w: 1.6 }, { dash: "6 4", w: 1.6 }, { dash: "2 3", w: 1.8 }, { dash: "10 3 2 3", w: 1.6 }];
    var hidden = {}, smooth = 20, chartBox = el("div"), r = readout();
    function series() {
      var k = 0;
      return rows.map(function (row) {
        var name = row[0], isBase = name === "baseline", st = isBase ? { dash: null, w: 2.4 } : styles[1 + (k++ % 3)];
        return { name: name, label: row[1], values: movingAverage(E.curves[name], smooth), color: isBase ? C.blue : (name === "gamma_0" || name === "hidden_4" ? C.ink2 : C.muted), dash: st.dash, width: st.w, hidden: hidden[name] };
      });
    }
    function build() {
      clear(chartBox);
      var s = series(), maxLen = 0;
      s.forEach(function (x) { maxLen = Math.max(maxLen, x.values.length); });
      var ch = lineChart({ series: s, yMax: 30, xLabel: "game (average of 5 seeds, " + smooth + "-game moving average)", yLabel: "apples eaten", right: 160,
        tip: function (i) { return "<span class='k'>game</span> " + (i + 1) + "<br>" + s.filter(function (x) { return !x.hidden && x.values[i] !== undefined; }).map(function (x) { return "<span class='k'>" + x.label + "</span> " + x.values[i].toFixed(1); }).join("<br>"); } });
      chartBox.appendChild(ch.node);
    }
    var toggles = rows.map(function (row) {
      var b = btn(row[1], function () { hidden[row[0]] = !hidden[row[0]]; b.setAttribute("aria-pressed", hidden[row[0]] ? "false" : "true"); build(); }, { "aria-pressed": "true" });
      return b;
    });
    var sm = slider("smoothing (games)", 1, 50, 1, smooth, function (v) { smooth = v; build(); });
    var table = el("table", { class: "ptable", style: { cursor: "default", marginTop: "14px" } });
    table.appendChild(el("tr", null, el("th", { text: "variant" }), el("th", { text: "last 100 training games" }), el("th", { text: "greedy eval, 100 games" }), el("th", { text: "per seed" })));
    rows.forEach(function (row) {
      var v = E.variants[row[0]];
      table.appendChild(el("tr", null, el("td", { text: row[1], style: { color: row[0] === "baseline" ? C.blue : "" } }), el("td", { text: v.last100_mean.toFixed(1) + " ± " + v.last100_std.toFixed(1) }),
        el("td", { text: v.eval_mean.toFixed(1) + " ± " + v.eval_std.toFixed(1) }), el("td", { text: v.eval_per_seed.map(function (x) { return x.toFixed(1); }).join("  ") })));
    });
    body.appendChild(chartBox);
    body.appendChild(el("div", { class: "controls" }, el("span", { class: "tag", text: "Show:" }), toggles));
    body.appendChild(el("div", { style: { marginTop: "6px" } }, sm.node));
    body.appendChild(el("div", { style: { overflowX: "auto" } }, table));
    if (intro) { r.set(intro, "WHAT TO LOOK FOR"); body.appendChild(r); }
    build();
  }
  figures.curves_stability = function (body) { curvesFigure(body, "stability", "Both tricks change the final score very little here. The visible difference is speed: without replay memory (dashed) the curve climbs about 40 games later, because every step is used for one update and then thrown away."); };
  figures.curves_epsilon = function (body) { curvesFigure(body, "epsilon", "The curves rise roughly when epsilon gets small, because only then does the snake play its own policy long enough to eat a lot. Decaying over 50 games learns first; decaying over 300 learns last but scored best in evaluation."); };
  figures.curves_gamma = function (body) { curvesFigure(body, "gamma", "γ = 0 (dark) is the only setting that clearly fails: the snake learns to avoid crashing and to grab food that is right next to it, and stops near 11 apples. Everything from 0.5 up reaches the same plateau."); };
  figures.curves_hidden = function (body) { curvesFigure(body, "hidden", "Four hidden units cannot represent the policy and barely leave zero. Sixteen are already enough. 256 units are not better, just slower."); };
  figures.curves_lr = function (body) { curvesFigure(body, "lr", "The learning rate shifts when the curve rises more than where it ends."); };
  figures.curves_optimizer = function (body) { curvesFigure(body, "optimizer", "On a problem this small, plain gradient descent reaches the same plateau as Adam. Adam's advantage shows on bigger networks with badly scaled gradients."); };

  // ------------------------------------------------------------------ FIG_013 the main training run

  figures.trainlog = function (body) {
    var D = data().main, log = D.log, n = log.score.length, view = "score", smooth = 20, box = el("div"), r = readout();
    function build() {
      clear(box);
      var series, yLabel, yMax;
      if (view === "score") {
        series = [{ values: log.score, color: C.blueSoft, bars: true, opacity: 0.9 }, { label: smooth + "-game average", values: movingAverage(log.score, smooth), color: C.blue, width: 2.2 }];
        yLabel = "apples eaten"; yMax = Math.max.apply(null, log.score) * 1.08;
      } else if (view === "steps") {
        series = [{ values: log.steps, color: C.blueSoft, bars: true, opacity: 0.9 }, { label: smooth + "-game average", values: movingAverage(log.steps, smooth), color: C.blue, width: 2.2 }];
        yLabel = "steps survived"; yMax = Math.max.apply(null, log.steps) * 1.08;
      } else {
        var loss = log.loss.map(function (v) { return v === null ? null : v; });
        series = [{ label: "mean loss per game", values: loss, color: C.blue, width: 1.6 }];
        yLabel = "mean squared error"; yMax = Math.max.apply(null, loss.filter(function (v) { return v !== null; })) * 1.08;
      }
      var firstLow = log.epsilon.findIndex(function (e) { return e < 0.5; });
      var ch = lineChart({ series: series, yMax: yMax, xLabel: "game", yLabel: yLabel, right: 120, band: { to: firstLow + 1, label: "MOSTLY RANDOM (ε > 0.5)" },
        tip: function (i) { return "<span class='k'>game</span> " + (i + 1) + "<br><span class='k'>score</span> " + log.score[i] + "<br><span class='k'>steps</span> " + log.steps[i] + "<br><span class='k'>epsilon</span> " + log.epsilon[i].toFixed(3) + "<br><span class='k'>loss</span> " + (log.loss[i] === null ? "–" : log.loss[i].toFixed(3)) + "<br><span class='k'>time</span> " + log.seconds[i].toFixed(1) + " s"; } });
      box.appendChild(ch.node);
    }
    var views = [["score", "Score"], ["steps", "Steps"], ["loss", "Loss"]].map(function (v) {
      var b = btn(v[1], function () { view = v[0]; press(views, b); build(); paint(); });
      return b;
    });
    function paint() {
      var firstTen = log.score.findIndex(function (_, i) { return i >= 9 && movingAverage(log.score, 20)[i] >= 10; });
      var msg = view === "score" ? "Almost nothing for 100 games while epsilon is high, then a steep climb between games 130 and 165, then a plateau around 24 with a lot of noise. The 20-game average first passes 10 apples at game <b>" + (firstTen + 1) + "</b>. Best game while training: <b>" + D.train_record + "</b>."
        : view === "steps" ? "Games get longer as the snake gets better. Training time is dominated by the late games: the first 150 took about " + log.seconds[149].toFixed(1) + " s, the whole run " + D.train_seconds.toFixed(1) + " s."
          : "The loss is not a score. It rises while the agent gets better, because better play means bigger Q-values (more food ahead) and bigger targets to be wrong about. In reinforcement learning, watch the reward, not the loss.";
      r.set(msg, view.toUpperCase());
    }
    var sm = slider("smoothing (games)", 1, 50, 1, smooth, function (v) { smooth = v; build(); });
    var ev = D.eval;
    body.appendChild(el("div", { class: "stat-row", style: { marginBottom: "12px" } }, el("span", { html: "games<b>" + n + "</b>" }), el("span", { html: "time<b>" + D.train_seconds.toFixed(1) + " s</b>" }),
      el("span", { html: "best while training<b>" + D.train_record + "</b>" }), el("span", { html: "greedy eval mean<b class='blue'>" + ev.mean.toFixed(2) + "</b>" }), el("span", { html: "eval best<b>" + ev.max + "</b>" })));
    body.appendChild(box);
    body.appendChild(el("div", { class: "controls" }, views));
    body.appendChild(el("div", { style: { marginTop: "6px" } }, sm.node));
    body.appendChild(r);
    press(views, views[0]); build(); paint();
  };

  // ------------------------------------------------------------------ FIG_014 the ablation overview

  figures.ablation = function (body) {
    var E = data().experiments, order = [["stability", "Replay and target"], ["gamma", "Gamma"], ["hidden", "Hidden units"], ["lr", "Learning rate"], ["optimizer", "Optimiser"], ["epsilon", "Exploration"]];
    var W = 960, rowH = 34, svgBox = el("div"), r = readout();
    function build(groupKey) {
      clear(svgBox);
      var rows = E.groups[groupKey], H = 60 + rows.length * rowH, L = 220, R = 60;
      function X(v) { return L + v / 40 * (W - L - R); }
      var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Greedy evaluation per variant" });
      [0, 10, 20, 30, 40].forEach(function (t) {
        svg.appendChild(sv("line", { class: "s-grid", x1: X(t), x2: X(t), y1: 10, y2: H - 30 }));
        svg.appendChild(sv("text", { class: "s-text-sm", x: X(t), y: H - 12, "text-anchor": "middle", text: String(t) }));
      });
      rows.forEach(function (row, i) {
        var v = E.variants[row[0]], y = 30 + i * rowH, isBase = row[0] === "baseline", col = isBase ? C.blue : C.muted;
        svg.appendChild(sv("text", { class: "s-text", x: L - 14, y: y + 4, "text-anchor": "end", text: row[1], style: isBase ? "fill:" + C.blue : "" }));
        v.eval_per_seed.forEach(function (s) { svg.appendChild(sv("circle", { cx: X(s), cy: y, r: 3.2, fill: "none", stroke: col, "stroke-width": 1.2 })); });
        svg.appendChild(sv("line", { x1: X(v.eval_mean - v.eval_std), x2: X(v.eval_mean + v.eval_std), y1: y, y2: y, stroke: col, "stroke-width": 1.6 }));
        svg.appendChild(sv("circle", { cx: X(v.eval_mean), cy: y, r: 6, fill: col, stroke: C.paper, "stroke-width": 2 }));
        svg.appendChild(sv("text", { class: "s-text-sm", x: X(Math.min(40, v.eval_mean + v.eval_std)) + 10, y: y + 4, text: v.eval_mean.toFixed(1) }));
      });
      svg.appendChild(sv("text", { class: "s-text-sm", x: L, y: H - 0, text: "MEAN SCORE, 100 GREEDY GAMES. FILLED DOT = MEAN OF 5 SEEDS, LINE = ±1 STD, RINGS = EACH SEED" }));
      svgBox.appendChild(svg);
      var best = rows.map(function (row) { return [row[1], E.variants[row[0]].eval_mean]; }).sort(function (a, b) { return b[1] - a[1]; });
      var spread = best[0][1] - best[best.length - 1][1];
      r.set("Best: <b>" + best[0][0] + "</b> (" + best[0][1].toFixed(1) + "). Worst: <b>" + best[best.length - 1][0] + "</b> (" + best[best.length - 1][1].toFixed(1) + "). " +
        (spread > 10 ? '<span class="warn">This setting really matters.</span>' : "A spread of " + spread.toFixed(1) + " apples is about the size of the seed-to-seed noise, so treat it as no clear difference."), "GROUP");
    }
    var chips = order.map(function (o) { var c = chip(o[1], function () { press(chips, c); build(o[0]); }); return c; });
    body.appendChild(el("div", { class: "controls", style: { marginTop: 0, marginBottom: "12px" } }, chips));
    body.appendChild(svgBox);
    body.appendChild(r);
    chips[0].click();
  };

  // ------------------------------------------------------------------ FIG_015 baselines

  figures.baselines = function (body) {
    var A = data().analysis, B = A.baselines, scores = A.baseline_scores;
    var names = [["random", "random moves"], ["rule", "hand-written rule"], ["network", "trained network"]];
    var W = 960, H = 220, L = 170, R = 40;
    function X(v) { return L + v / 70 * (W - L - R); }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Scores of three policies" });
    [0, 10, 20, 30, 40, 50, 60, 70].forEach(function (t) {
      svg.appendChild(sv("line", { class: "s-grid", x1: X(t), x2: X(t), y1: 10, y2: H - 36 }));
      svg.appendChild(sv("text", { class: "s-text-sm", x: X(t), y: H - 20, "text-anchor": "middle", text: String(t) }));
    });
    svg.appendChild(sv("text", { class: "s-text-sm", x: (L + W - R) / 2, y: H - 2, "text-anchor": "middle", text: "APPLES EATEN IN EACH OF THE SAME 100 GAMES (ONE DOT PER GAME, BAR = MEAN)" }));
    var rand = mulberry32(1);
    names.forEach(function (nm, i) {
      var y = 40 + i * 58, col = nm[0] === "network" ? C.blue : C.muted;
      svg.appendChild(sv("text", { class: "s-text", x: L - 14, y: y + 4, "text-anchor": "end", text: nm[1], style: nm[0] === "network" ? "fill:" + C.blue : "" }));
      scores[nm[0]].forEach(function (s) { svg.appendChild(sv("circle", { cx: X(s), cy: y + (rand() - 0.5) * 22, r: 2.4, fill: col, opacity: 0.45 })); });
      svg.appendChild(sv("line", { x1: X(B[nm[0]].mean), x2: X(B[nm[0]].mean), y1: y - 16, y2: y + 16, stroke: nm[0] === "network" ? C.blue : C.ink, "stroke-width": 2.4 }));
      svg.appendChild(sv("text", { class: "s-text", x: X(B[nm[0]].mean) + 8, y: y - 12, text: B[nm[0]].mean.toFixed(2) }));
    });
    var r = readout("SAME BOARDS, SAME FOOD");
    r.set("Random play averages <b>" + B.random.mean.toFixed(2) + "</b>. The rule (never step into danger, prefer the move towards the food) averages <b>" + B.rule.mean.toFixed(2) + "</b>. The network, which was never told that rule, averages <b>" + B.network.mean.toFixed(2) + "</b>. It learned a policy as good as the obvious hand-written one, and no better.");
    body.appendChild(svg);
    body.appendChild(r);
  };

  // ------------------------------------------------------------------ FIG_016 the 256 possible inputs

  figures.policy = function (body) {
    var A = data().analysis, m = data().model, filter = "seen", sel = null;
    var rows = A.table.map(function (t) {
      var f = forward(m, t[0]);
      return { s: t[0], visits: t[1], rule: t[2], net: ACTIONS[argmax(f.q)], q: f.q };
    });
    rows.sort(function (a, b) { return b.visits - a.visits; });
    var wrap = el("div", { class: "table-scroll" }), detail = readout(), q = QBars(), list = InputList(null);
    function bits(s) {
      var td = el("td", { class: "bits" });
      s.forEach(function (b, i) { if (i === 3 || i === 7) td.appendChild(el("i")); td.appendChild(el("span", { class: b ? "on" : "" })); });
      return td;
    }
    function paint() {
      clear(wrap);
      var t = el("table", { class: "ptable" });
      t.appendChild(el("tr", null, el("th", { text: "danger · heading · food" }), el("th", { text: "times seen" }), el("th", { text: "network" }), el("th", { text: "rule" }), el("th", { text: "Q straight / right / left" })));
      var shown = rows.filter(function (rw) {
        return filter === "all" || (filter === "seen" && rw.visits > 0) || (filter === "unseen" && rw.visits === 0) || (filter === "differ" && rw.net !== rw.rule);
      });
      shown.forEach(function (rw) {
        var tr = el("tr", { tabindex: "0", class: rw === sel ? "sel" : "", onclick: function () { pick(rw); }, onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(rw); } } },
          bits(rw.s), el("td", { text: String(rw.visits) }), el("td", { text: rw.net }), el("td", { class: rw.net !== rw.rule ? "diff" : "", text: rw.rule }),
          el("td", { text: rw.q.map(function (v) { return fmt(v, 1); }).join(" / ") }));
        t.appendChild(tr);
      });
      wrap.appendChild(t);
      count.textContent = shown.length + " rows";
    }
    function disagreement(rw) {
      if (rw.net === rw.rule) return "";
      var d = rw.s;
      if (rw.visits === 0) return " They disagree, but the snake never meets this input while playing, so there was never a training signal for it.";
      if (d[0] + d[1] + d[2] === 3) return " They disagree, but every move crashes here, so the choice does not matter.";
      if (d[0] === 0 && d[1] + d[2] === 1) return " The danger is on the " + (d[1] ? "right" : "left") + " only, and the network turns <b>away</b> from it. It does this in all 23 such inputs it meets; the rule does not.";
      return " Both moves are safe; the rule and the network just rank them differently.";
    }
    function pick(rw) {
      sel = rw;
      list.set(rw.s); q.set(rw.q);
      var on = LABELS.filter(function (_, i) { return rw.s[i]; });
      detail.set("Inputs: <code>" + on.join("</code> <code>") + "</code>. Seen <b>" + rw.visits + "</b> times in 100 greedy games. The network plays <b>" + rw.net + "</b>, the rule would play <b>" + rw.rule + "</b>." +
        disagreement(rw), "ROW");
      paint();
    }
    var count = el("span", { class: "tag" });
    var fs = [["seen", "Seen while playing"], ["differ", "Network ≠ rule"], ["unseen", "Never seen"], ["all", "All 256"]].map(function (f) {
      var c = chip(f[1], function () { filter = f[0]; press(fs, c); paint(); });
      return c;
    });
    body.appendChild(el("div", { class: "controls", style: { marginTop: 0, marginBottom: "12px" } }, fs, count));
    body.appendChild(el("div", { class: "split wide-left" }, wrap, el("div", null, list, el("div", { style: { marginTop: "12px" } }, q))));
    body.appendChild(detail);
    press(fs, fs[0]);
    paint();
    pick(rows[0]);
  };

  // ------------------------------------------------------------------ FIG_017 a real death, frame by frame

  figures.death = function (body) {
    var F = data().death.frames, board = new Board(20, 20, 20), list = InputList(null), q = QBars(), r = readout();
    var game = new Game(20, 20), space = el("div", { class: "cmd", style: { marginTop: "12px" } });
    function paint(i) {
      var f = F[i], last = i === F.length - 1, len = f.snake.length;
      game.setPosition(f.snake, f.dir, f.food);
      var hd = f.snake[0], dd = DIRS[f.dir];
      if (last) game.done = true;
      board.draw(game, { probes: !last, crash: last ? [hd[0] + dd[0], hd[1] + dd[1]] : null });
      list.set(f.state); q.set(f.q);
      var sp = [0, 1, 2].map(function (a) { return last ? 0 : game.spaceAfter(a); });
      var pick = argmax(f.q);
      space.innerHTML = "<h4>free cells after each move (flood fill, not an input)</h4>";
      var dl = el("dl");
      ACTIONS.forEach(function (name, a) {
        dl.appendChild(el("dt", { text: name }));
        dl.appendChild(el("dd", null, el("span", { class: a === pick && !last ? "changed" : "", text: sp[a] + (a === pick && !last ? "   \u2190 the network's choice" : "") })));
      });
      space.appendChild(dl);
      var best = Math.max.apply(null, sp), msg;
      if (last) msg = '<span class="bad">Crash.</span> Score ' + f.score + ". Every one of the 100 evaluation games ends like this, in the snake's own body.";
      else if (best === 0) msg = '<span class="bad">Every move crashes.</span> All three danger inputs are on. Nothing the network does now matters.';
      else if (sp[pick] < len && best >= len) {
        var other = sp.indexOf(best);
        msg = '<span class="bad">This is the fatal move.</span> Turning ' + ACTIONS[other] + " leads to <b>" + best + "</b> free cells; turning " + ACTIONS[pick] + " leads to <b>" + sp[pick] + "</b>. To the network the two look almost identical: Q = " + fmt(f.q[other]) + " against " + fmt(f.q[pick]) + ", a difference of " + fmt(Math.abs(f.q[pick] - f.q[other])) + ". Its inputs say \u201cno danger\u201d for both, because they only look one cell ahead.";
      }
      else if (sp[pick] < len) msg = '<span class="warn">Trapped.</span> The best move leads to only ' + sp[pick] + " free cells, fewer than the snake's length of " + len + ". The fatal choice was already made.";
      else msg = "Plenty of room: the move it picks leaves <b>" + sp[pick] + "</b> free cells. Length " + len + ".";
      r.set(msg, "FRAME " + (i + 1) + " / " + F.length + " \u00b7 SCORE " + f.score);
    }
    var stp = stepper(F.length, paint);
    var fatal = 0;
    for (var i = 0; i < F.length - 1; i++) {
      game.setPosition(F[i].snake, F[i].dir, F[i].food);
      var sp = [0, 1, 2].map(function (a) { return game.spaceAfter(a); }), pk = argmax(F[i].q);
      if (sp[pk] < F[i].snake.length && Math.max.apply(null, sp) >= F[i].snake.length) { fatal = i; break; }
    }
    body.appendChild(el("div", { class: "split" }, el("div", null, board.canvas), el("div", null, list, el("div", { style: { marginTop: "12px" } }, q), space)));
    body.appendChild(el("div", { class: "controls" }, stp.node, el("span", { class: "sep" }), btn("Jump to the fatal move", function () { stp.go(fatal); }), btn("Jump to the end", function () { stp.go(F.length - 1); })));
    body.appendChild(r);
    stp.go(0);
  };

  // ------------------------------------------------------------------ FIG_018 rebuild checklist

  figures.checklist = function (body) {
    var items = [
      ["Set up", "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt", "imports work"],
      ["Game", "write game.py: reset, step, get_state", "tests/test_game.py passes"],
      ["Network", "write forward, backward, q_loss, Adam", "gradient check below 1e-6"],
      ["Agent", "epsilon-greedy, replay memory, Bellman target", "tests/test_agent.py passes"],
      ["Train", "python train.py", "greedy mean above 20 in about 12 s"],
      ["Measure", "python evaluate.py and python analyze.py", "network close to the rule baseline"],
      ["Experiment", "python experiments.py", "gamma 0 and 4 hidden units fail, the rest do not"],
      ["Explain", "answer every question on the questions page out loud", "no notes needed"]
    ];
    var KEY = "snake-guide-checklist", done = {};
    try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
    var ul = el("ul", { class: "ledger", style: { marginTop: 0 } }), prog = el("div", { class: "stat-row", style: { marginTop: "12px" } });
    function save() { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) { /* private mode: progress just is not kept */ } }
    function paint() {
      clear(ul);
      var n = 0;
      items.forEach(function (it, i) {
        if (done[i]) n++;
        var b = el("button", { type: "button", class: "btn", "aria-pressed": done[i] ? "true" : "false", text: done[i] ? "done" : String(i + 1).padStart(2, "0"),
          onclick: function () { done[i] = !done[i]; save(); paint(); } });
        ul.appendChild(el("li", null, el("span", null, b), el("div", null, el("b", { text: it[0] + ". " }), el("code", { text: it[1], style: { fontSize: "12.5px", background: "#efeff2", padding: "1px 5px", borderRadius: "3px" } }),
          el("div", { class: "tag", style: { marginTop: "4px" }, text: "done when: " + it[2] }))));
      });
      prog.innerHTML = "progress<b class='blue'>" + n + " / " + items.length + "</b>";
    }
    body.appendChild(ul);
    body.appendChild(prog);
    paint();
  };

  // ------------------------------------------------------------------ loader

  function build() {
    var figs = document.querySelectorAll("figure.fig[data-fig]");
    Array.prototype.forEach.call(figs, function (fig) {
      var body = fig.querySelector(".fig-body"), name = fig.getAttribute("data-fig");
      if (!body || body.getAttribute("data-built")) return;
      body.setAttribute("data-built", "1");
      try {
        if (!data()) throw new Error("data.js did not load");
        if (!figures[name]) throw new Error("no figure called " + name);
        figures[name](body);
      } catch (err) {
        clear(body);
        body.appendChild(el("p", { class: "fig-error", text: "This figure failed to load. (" + err.message + ")" }));
        if (window.console) console.error("[figure " + name + "]", err);
      }
    });
  }
  window.SnakeGuide = { Game: Game, forward: forward, selfTest: selfTest, figures: figures };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
