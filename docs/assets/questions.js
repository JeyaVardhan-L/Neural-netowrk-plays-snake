// The questions wheel: the active question sits in the middle, the others blur and fade with distance.
(function () {
  "use strict";
  var ALL = window.QUESTIONS || [], list = document.getElementById("qs-list"), wheel = document.getElementById("qs-wheel");
  if (!list || !ALL.length) return;
  var qEl = document.getElementById("qs-q"), aEl = document.getElementById("qs-a"), count = document.getElementById("qs-count"), src = document.getElementById("qs-src");
  var select = document.getElementById("qs-select"), filters = document.getElementById("qs-filters");
  var topic = "all", items = ALL, active = 0, lis = [];

  var topics = ["all"];
  ALL.forEach(function (q) { if (topics.indexOf(q.cat) < 0) topics.push(q.cat); });
  var chips = topics.map(function (t) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = t === "all" ? "all " + ALL.length : t;
    b.addEventListener("click", function () { topic = t; render(0); });
    filters.appendChild(b);
    return b;
  });

  function render(start) {
    items = topic === "all" ? ALL : ALL.filter(function (q) { return q.cat === topic; });
    chips.forEach(function (c, i) { c.setAttribute("aria-pressed", topics[i] === topic ? "true" : "false"); });
    list.innerHTML = ""; select.innerHTML = "";
    lis = items.map(function (q, i) {
      var li = document.createElement("li");
      li.textContent = q.q;
      li.addEventListener("click", function () { go(i); });
      list.appendChild(li);
      var o = document.createElement("option"); o.value = i; o.textContent = (i + 1) + ". " + q.q; select.appendChild(o);
      return li;
    });
    go(start || 0, true);
  }

  function go(i, instant) {
    active = Math.max(0, Math.min(items.length - 1, i));
    var q = items[active];
    qEl.textContent = q.q;
    aEl.innerHTML = q.a;
    count.textContent = (active + 1) + " / " + items.length + " · " + q.cat;
    src.href = q.src; src.textContent = q.srcLabel || "read more";
    select.value = active;
    var center = wheel.clientHeight / 2, offset = 0;
    lis.forEach(function (li, k) {
      var d = Math.abs(k - active);
      li.classList.toggle("active", k === active);
      li.style.filter = k === active ? "none" : "blur(" + Math.min(4.5, 0.9 + d * 0.9) + "px)";
      li.style.opacity = k === active ? 1 : Math.max(0.12, 0.78 - d * 0.14);
    });
    var target = lis[active];
    if (target) {
      offset = center - (target.offsetTop + target.offsetHeight / 2);
      if (instant) { list.style.transition = "none"; list.style.transform = "translateY(" + offset + "px)"; void list.offsetWidth; list.style.transition = ""; }
      else list.style.transform = "translateY(" + offset + "px)";
    }
  }

  wheel.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(active + 1); }
    if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(active - 1); }
  });
  var wheelLock = 0;
  wheel.addEventListener("wheel", function (e) {
    e.preventDefault();
    var now = Date.now();
    if (now - wheelLock < 180) return;
    wheelLock = now;
    go(active + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  document.getElementById("qs-prev").addEventListener("click", function () { go(active - 1); });
  document.getElementById("qs-next").addEventListener("click", function () { go(active + 1); });
  select.addEventListener("change", function () { go(+select.value); });
  window.addEventListener("resize", function () { go(active, true); });
  render(0);
})();
