// The annotated source reader. Data comes from source-data.js (built by tools/guide/build.py).
// Links: source.html#path@text jumps to the first line containing text; #path:123 to line 123.
(function () {
  "use strict";
  var D = window.SOURCE_DATA, list = document.getElementById("src-list"), view = document.getElementById("src-view");
  var filter = document.getElementById("src-filter");
  if (!D || !list || !view) return;

  var KW = new Set("def class return if elif else for while in not and or import from as with try except finally raise pass break continue lambda yield is assert global nonlocal del async await".split(" "));
  var CONST = new Set(["None", "True", "False", "self"]);
  var TY = new Set("int float str list dict tuple set bool bytes object type range len print isinstance min max sum enumerate zip sorted open super property staticmethod classmethod dataclass np deque Path".split(" "));

  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Highlight one file, keeping track of triple-quoted strings across lines.
  function highlight(lines) {
    var out = [], open = null;  // open = '"""' or "'''" while inside a docstring
    lines.forEach(function (line) {
      var html = "", i = 0, prev = "";
      while (i < line.length) {
        if (open) {
          var end = line.indexOf(open, i);
          if (end < 0) { html += '<span class="tk-st">' + esc(line.slice(i)) + "</span>"; i = line.length; break; }
          html += '<span class="tk-st">' + esc(line.slice(i, end + 3)) + "</span>"; i = end + 3; open = null; continue;
        }
        var rest = line.slice(i), m;
        if (rest[0] === "#") { html += '<span class="tk-co">' + esc(rest) + "</span>"; break; }
        if ((m = /^[rbfRBF]{0,2}("""|''')/.exec(rest))) {
          var q = m[1], close = rest.indexOf(q, m[0].length);
          if (close < 0) { html += '<span class="tk-st">' + esc(rest) + "</span>"; open = q; break; }
          html += '<span class="tk-st">' + esc(rest.slice(0, close + 3)) + "</span>"; i += close + 3; continue;
        }
        if ((m = /^[rbfRBF]{0,2}("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(rest))) { html += '<span class="tk-st">' + esc(m[0]) + "</span>"; i += m[0].length; continue; }
        if ((m = /^@[\w.]+/.exec(rest)) && /^\s*$/.test(line.slice(0, i))) { html += '<span class="tk-pp">' + esc(m[0]) + "</span>"; i += m[0].length; continue; }
        if ((m = /^\d[\d_]*(\.\d+)?(e[-+]?\d+)?/i.exec(rest)) && !/\w$/.test(line.slice(0, i))) { html += '<span class="tk-nu">' + m[0] + "</span>"; i += m[0].length; continue; }
        if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
          var w = m[0], cls = null;
          if (prev === "def" || prev === "class") cls = "tk-fn";
          else if (KW.has(w)) cls = "tk-kw";
          else if (CONST.has(w)) cls = "tk-kw";
          else if (TY.has(w)) cls = "tk-ty";
          html += cls ? '<span class="' + cls + '">' + w + "</span>" : w;
          prev = w; i += w.length; continue;
        }
        html += esc(rest[0]); if (!/\s/.test(rest[0])) prev = rest[0]; i++;
      }
      out.push(html);
    });
    return out;
  }

  var byPath = {}, links = {};
  D.files.forEach(function (f) { byPath[f.path] = f; });

  function buildList() {
    var groups = [], seen = {};
    D.files.forEach(function (f) { if (!seen[f.group]) { seen[f.group] = []; groups.push(f.group); } seen[f.group].push(f); });
    groups.forEach(function (g) {
      var h = document.createElement("h5"); h.textContent = g; list.appendChild(h);
      seen[g].forEach(function (f) {
        var a = document.createElement("a");
        a.href = "#" + f.path; a.textContent = f.path; a.title = f.title;
        list.appendChild(a); links[f.path] = a;
      });
    });
  }

  var shown = null;
  function show(path) {
    var f = byPath[path];
    if (!f) return false;
    Object.keys(links).forEach(function (p) { links[p].setAttribute("aria-current", p === path ? "true" : "false"); });
    if (shown === path) return true;
    shown = path;
    var hl = highlight(f.lines), html = '<header class="src-file-head"><span class="path">' + esc(f.path) + "</span><h2>" + esc(f.title) + "</h2></header>";
    f.blocks.forEach(function (b, k) {
      var code = "";
      for (var n = b.start; n <= b.end; n++) code += '<span class="line" id="L' + n + '"><span class="ln">' + n + "</span>" + (hl[n - 1] || " ") + "</span>";
      html += '<div class="src-block" id="b' + k + '"><div class="src-code"><pre>' + code + '</pre></div><div class="src-note"><div class="src-note-inner">' + b.note + "</div></div></div>";
    });
    view.innerHTML = html;
    document.title = f.path + " · Annotated source · Snake NN field guide";
    return true;
  }

  function lineFor(f, spec) {
    if (!spec) return 0;
    if (/^\d+$/.test(spec)) return +spec;
    for (var i = 0; i < f.lines.length; i++) if (f.lines[i].indexOf(spec) >= 0) return i + 1;
    return 0;
  }

  function route() {
    var h = decodeURIComponent(location.hash.slice(1)), path = h, spec = "";
    var at = h.indexOf("@"), colon = h.search(/:\d+$/);
    if (at >= 0) { path = h.slice(0, at); spec = h.slice(at + 1); }
    else if (colon >= 0) { path = h.slice(0, colon); spec = h.slice(colon + 1); }
    if (!byPath[path]) { path = D.files[0].path; spec = ""; }
    var changed = shown !== path;
    show(path);
    var n = lineFor(byPath[path], spec);
    if (n) {
      var line = document.getElementById("L" + n);
      if (line) {
        var block = line.closest(".src-block");
        view.querySelectorAll(".line.hit").forEach(function (l) { l.classList.remove("hit"); });
        line.classList.add("hit");
        var y = line.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: y, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        if (block) { block.classList.remove("flash"); void block.offsetWidth; block.classList.add("flash"); }
      }
    } else if (changed) {
      window.scrollTo({ top: 0 });
    }
  }

  filter.addEventListener("input", function () {
    var q = filter.value.toLowerCase();
    Object.keys(links).forEach(function (p) { links[p].style.display = p.toLowerCase().indexOf(q) >= 0 || byPath[p].title.toLowerCase().indexOf(q) >= 0 ? "" : "none"; });
  });
  buildList();
  window.addEventListener("hashchange", route);
  route();
})();
