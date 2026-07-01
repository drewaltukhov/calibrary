// Calibrary in-browser EPUB reader, built on epub.js.
// Reads the file path + book id from the <body data-*> attributes.
(async function () {
  "use strict";
  var body = document.body;
  var url = body.getAttribute("data-epub");
  var key = "calibrary:pos:" + body.getAttribute("data-book");
  var viewer = document.getElementById("viewer");
  var loading = document.querySelector(".reader-loading");
  var bar = document.querySelector(".reader-progress");

  if (!window.ePub) {
    loading.textContent = "Reader failed to load.";
    return;
  }

  // Decrypt the EPUB before handing it to epub.js.
  var ck = await CalCrypto.getKey();
  if (!ck) { CalCrypto.redirectToLogin(); return; }
  var buffer;
  try {
    buffer = await CalCrypto.decryptUrl(ck, url);
  } catch (e) {
    loading.textContent = "Could not decrypt this book.";
    return;
  }

  var book = ePub(buffer.buffer || buffer);
  var rendition = book.renderTo("viewer", {
    width: "100%", height: "100%",
    flow: "paginated", spread: "auto", manager: "default"
  });

  // Reading theme inside the book iframe — pulled from the site's
  // CSS variables so it always matches the current palette.
  var cs = getComputedStyle(document.documentElement);
  var v = function (name, fallback) {
    return (cs.getPropertyValue(name) || "").trim() || fallback;
  };
  var paper = v("--reader-bg", "#ece4d2");
  var ink = v("--reader-fg", "#2a2320");
  var accent = v("--accent", "#9a6d20");
  rendition.themes.register("stacks", {
    "body": {
      "background": paper + " !important",
      "color": ink + " !important",
      "font-family": "Georgia, 'Newsreader', serif !important",
      "line-height": "1.7 !important",
      "padding": "0 8px !important"
    },
    "p, li": { "font-size": "1.05rem !important" },
    "a": { "color": accent + " !important" },
    "h1,h2,h3,h4": { "color": ink + " !important", "font-family": "Georgia, serif !important" },
    "img": { "max-width": "100% !important", "height": "auto !important" }
  });
  rendition.themes.select("stacks");

  var saved = null;
  try { saved = localStorage.getItem(key); } catch (e) {}

  book.ready.then(function () {
    return book.locations.generate(1000);
  }).then(function () {
    updateProgress();
  });

  var displayed = rendition.display(saved || undefined);
  displayed.then(function () {
    if (loading) loading.style.display = "none";
  }).catch(function () {
    if (loading) loading.textContent = "Could not open this book.";
  });

  function updateProgress() {
    var loc = rendition.currentLocation();
    if (!loc || !loc.start || !book.locations || !book.locations.length()) return;
    var pct = book.locations.percentageFromCfi(loc.start.cfi);
    if (bar) bar.style.width = Math.round(pct * 100) + "%";
  }

  rendition.on("relocated", function (location) {
    try { localStorage.setItem(key, location.start.cfi); } catch (e) {}
    updateProgress();
  });

  // navigation: buttons, arrow keys, tap zones
  function prev() { rendition.prev(); }
  function next() { rendition.next(); }
  document.querySelector("[data-prev]").addEventListener("click", prev);
  document.querySelector("[data-next]").addEventListener("click", next);
  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });
  rendition.on("keyup", function (e) {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });

  // font size controls
  var size = 100;
  try { size = parseInt(localStorage.getItem("calibrary:fs") || "100", 10); } catch (e) {}
  function setSize(v) {
    size = Math.min(160, Math.max(70, v));
    rendition.themes.fontSize(size + "%");
    try { localStorage.setItem("calibrary:fs", String(size)); } catch (e) {}
  }
  setSize(size);
  var inc = document.querySelector("[data-font-inc]");
  var dec = document.querySelector("[data-font-dec]");
  if (inc) inc.addEventListener("click", function () { setSize(size + 10); });
  if (dec) dec.addEventListener("click", function () { setSize(size - 10); });
})();
