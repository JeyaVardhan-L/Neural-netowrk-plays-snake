// Top bar behaviour and small page helpers.
(function () {
  "use strict";
  var bar = document.querySelector(".topbar");
  function onScroll() {
    if (bar) bar.classList.toggle("scrolled", window.scrollY > 4);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Flash the target of an in-page link so the eye can find it.
  function flashHash() {
    if (!location.hash || location.hash.length < 2) return;
    var t;
    try { t = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { return; }
    if (!t) return;
    t.classList.remove("flash");
    void t.offsetWidth;
    t.classList.add("flash");
  }
  window.addEventListener("hashchange", flashHash);
  window.addEventListener("load", flashHash);
})();
