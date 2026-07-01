// Calibrary — progressive enhancement. The site works without JS;
// this adds live filtering, sorting, and the mobile menu.
(function () {
  "use strict";

  // ---- mobile menu ----------------------------------------------------
  var toggle = document.querySelector(".menu-toggle");
  var mnav = document.querySelector(".site-nav-mobile");
  if (toggle && mnav) {
    toggle.addEventListener("click", function () {
      var open = mnav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // ---- header search: as-you-type dropdown (title / author) -----------
  (function () {
    var forms = document.querySelectorAll("[data-search-form]");
    if (!forms.length) return;
    var home = (window.CAL && window.CAL.home) || "";
    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    };
    var norm = function (s) { return (s || "").toLowerCase(); };

    var idxPromise = null;
    function loadIndex() {
      if (idxPromise) return idxPromise;
      idxPromise = (async function () {
        if (!window.CalCrypto) return [];
        var k = await CalCrypto.getKey();
        if (!k) return [];
        try {
          var buf = await CalCrypto.decryptUrl(k, home + "search.json.enc");
          return JSON.parse(new TextDecoder().decode(buf));
        } catch (e) { return []; }
      })();
      return idxPromise;
    }
    function match(list, q) {
      q = norm(q).trim();
      if (!q) return [];
      var starts = [], has = [];
      for (var i = 0; i < list.length; i++) {
        var b = list[i], t = norm(b.t), a = norm(b.a);
        if (t.indexOf(q) === 0 || a.indexOf(q) === 0) starts.push(b);
        else if (t.indexOf(q) > -1 || a.indexOf(q) > -1) has.push(b);
      }
      return starts.concat(has).slice(0, 8);
    }

    forms.forEach(function (form) {
      var input = form.querySelector("input");
      var box = form.querySelector("[data-search-results]");
      var active = -1, timer;

      function close() { box.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; }
      function open() { box.hidden = false; input.setAttribute("aria-expanded", "true"); }
      function highlight() {
        var links = box.querySelectorAll("a");
        links.forEach(function (l, i) {
          l.classList.toggle("is-active", i === active);
          if (i === active) l.scrollIntoView({ block: "nearest" });
        });
      }
      function render(results) {
        if (!input.value.trim()) return close();
        if (!results.length) { box.innerHTML = '<div class="search__empty">' + (window.Calibrary && Calibrary.t ? Calibrary.t("search.none") : "No matching books") + "</div>"; return open(); }
        box.innerHTML = results.map(function (b) {
          return '<a role="option" href="' + home + "book/" + b.id + '/">' +
            '<span class="search__result-t">' + esc(b.t) + "</span>" +
            '<span class="search__result-a">' + esc(b.a) + (b.s ? " · " + esc(b.s) : "") + "</span></a>";
        }).join("");
        active = -1; open();
      }
      function run() {
        clearTimeout(timer);
        timer = setTimeout(async function () { render(match(await loadIndex(), input.value)); }, 110);
      }

      input.addEventListener("input", run);
      input.addEventListener("focus", function () { if (input.value.trim()) run(); });
      input.addEventListener("keydown", function (e) {
        var links = box.querySelectorAll("a");
        if (e.key === "ArrowDown") { e.preventDefault(); if (links.length) { active = Math.min(active + 1, links.length - 1); highlight(); } }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
        else if (e.key === "Enter") { if (active > -1 && links[active]) { e.preventDefault(); location.href = links[active].href; } }
        else if (e.key === "Escape") { close(); input.blur(); }
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = input.value.trim();
        location.href = form.getAttribute("data-jump") + (q ? "?q=" + encodeURIComponent(q) : "");
      });
      document.addEventListener("click", function (e) { if (!form.contains(e.target)) close(); });
    });
  })();

  // ---- listing page: filter / sort ------------------------------------
  var grid = document.querySelector("[data-filterable]");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll("[data-card]"));
  var qInput = document.querySelector("[data-filter-q]");
  var genreSel = document.querySelector("[data-filter-genre]");
  var sortSel = document.querySelector("[data-sort]");
  var count = document.querySelector("[data-count]");
  var empty = document.querySelector("[data-empty]");

  function norm(s) { return (s || "").toLowerCase(); }

  function apply() {
    var q = norm(qInput && qInput.value);
    var g = genreSel ? genreSel.value : "";
    var shown = 0;
    cards.forEach(function (c) {
      var hay = norm(c.getAttribute("data-search"));
      var genres = "|" + (c.getAttribute("data-genres") || "") + "|";
      var ok = (!q || hay.indexOf(q) !== -1) && (!g || genres.indexOf("|" + g + "|") !== -1);
      c.hidden = !ok;
      if (ok) shown++;
    });
    if (count) count.textContent = (window.Calibrary && Calibrary.t) ? Calibrary.t("count.books", { n: shown }) : (shown + " books");
    if (empty) empty.hidden = shown !== 0;
  }

  function sortCards() {
    if (!sortSel) return;
    var key = sortSel.value;
    var arr = cards.slice().sort(function (a, b) {
      if (key === "title") return a.getAttribute("data-title").localeCompare(b.getAttribute("data-title"));
      if (key === "author") return a.getAttribute("data-author").localeCompare(b.getAttribute("data-author"));
      if (key === "newest") return (+b.getAttribute("data-added")) - (+a.getAttribute("data-added"));
      if (key === "year") return (+b.getAttribute("data-year")) - (+a.getAttribute("data-year"));
      return 0;
    });
    arr.forEach(function (c) { grid.appendChild(c); });
  }

  if (qInput) qInput.addEventListener("input", apply);
  if (genreSel) genreSel.addEventListener("change", apply);
  if (sortSel) sortSel.addEventListener("change", function () { sortCards(); });

  // honor ?q= from the URL (header search hand-off)
  var urlQ = new URLSearchParams(location.search).get("q");
  if (urlQ && qInput) { qInput.value = urlQ; }
  apply();
  document.addEventListener("calibrary:lang", apply);   // re-localize the count
})();

// ---- shared namespace ------------------------------------------------
window.Calibrary = window.Calibrary || {};

// ---- decrypt covers lazily as they scroll into view -----------------
// Callable on any scope so freshly-rendered cards (Read Next) reveal too.
Calibrary.revealCovers = function (scope) {
  if (!window.CalCrypto) return;
  scope = scope || document;
  var imgs = Array.prototype.slice.call(scope.querySelectorAll("img[data-enc]:not([data-cov])"));
  if (!imgs.length) return;
  imgs.forEach(function (i) { i.setAttribute("data-cov", "1"); });
  CalCrypto.getKey().then(function (key) {
    if (!key) return;
    function reveal(img) {
      CalCrypto.decryptUrlToBlob(key, img.getAttribute("data-enc"), "image/jpeg")
        .then(function (blob) { img.src = URL.createObjectURL(blob); img.classList.add("is-loaded"); })
        .catch(function () { img.classList.add("is-error"); });
    }
    if (!("IntersectionObserver" in window)) { imgs.forEach(reveal); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target); reveal(en.target);
      });
    }, { rootMargin: "500px 0px" });
    imgs.forEach(function (i) { io.observe(i); });
  });
};
Calibrary.revealCovers(document);

// ---- encrypted downloads --------------------------------------------
(function () {
  "use strict";
  if (!window.CalCrypto) return;
  document.querySelectorAll("[data-download]").forEach(function (btn) {
    btn.addEventListener("click", async function (e) {
      e.preventDefault();
      var key = await CalCrypto.getKey();
      if (!key) return CalCrypto.redirectToLogin();
      var label = btn.textContent;
      btn.setAttribute("aria-busy", "true"); btn.textContent = "Preparing…";
      try {
        var blob = await CalCrypto.decryptUrlToBlob(key, btn.getAttribute("data-download"), "application/epub+zip");
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = btn.getAttribute("data-name") || "book.epub";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000);
      } catch (err) { alert("Could not prepare the download."); }
      btn.removeAttribute("aria-busy"); btn.textContent = label;
    });
  });
})();

// ---- carousels (related-book rails) ---------------------------------
(function () {
  "use strict";
  document.querySelectorAll("[data-carousel]").forEach(function (car) {
    var track = car.querySelector("[data-carousel-track]");
    var prev = car.querySelector("[data-carousel-prev]");
    var next = car.querySelector("[data-carousel-next]");
    if (!track || !prev || !next) return;
    function update() {
      var max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      var overflow = track.scrollWidth > track.clientWidth + 4;
      car.classList.toggle("has-overflow", overflow);
    }
    function step(dir) { track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" }); }
    prev.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  });
})();

// ====================================================================
// Bookmarks ("Read Next" queue) — stored per browser in localStorage.
// ====================================================================
var BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
var BM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.4l-6.5-3.7-6.5 3.7V4a.5.5 0 0 1 .5-.5z"/></svg>';

Calibrary.bookmarks = (function () {
  var K = "calibrary:bookmarks";
  function read() { try { return JSON.parse(localStorage.getItem(K) || "[]"); } catch (e) { return []; } }
  function write(a) { try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {} }
  return {
    list: read,
    count: function () { return read().length; },
    has: function (id) { return read().indexOf(+id) > -1; },
    toggle: function (id) {
      id = +id; var a = read(); var i = a.indexOf(id);
      if (i > -1) a.splice(i, 1); else a.unshift(id);   // newest first
      write(a); return a.indexOf(id) > -1;
    },
  };
})();

(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var home = (window.CAL && window.CAL.home) || "";

  function reflect(btn) {
    var saved = Calibrary.bookmarks.has(btn.getAttribute("data-bookmark"));
    btn.setAttribute("aria-pressed", saved ? "true" : "false");
    btn.classList.toggle("is-saved", saved);
    var el = btn.querySelector("[data-bm-text]");
    if (el) {
      var key = saved ? "bm.saved" : "bm.readnext";
      el.setAttribute("data-i18n", key);
      el.textContent = Calibrary.t ? Calibrary.t(key) : (saved ? "Saved for later" : "Read next");
    }
  }
  Calibrary.wireBookmarks = function (scope) {
    (scope || document).querySelectorAll("[data-bookmark]").forEach(function (btn) {
      reflect(btn);
      if (btn._bmWired) return;
      btn._bmWired = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        Calibrary.bookmarks.toggle(btn.getAttribute("data-bookmark"));
        document.dispatchEvent(new CustomEvent("calibrary:bookmarks"));
      });
    });
  };
  Calibrary.refreshBadge = function () {
    var n = Calibrary.bookmarks.count();
    document.querySelectorAll("[data-bm-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
  };

  // book-card index (id, title, author, series, series_index, spine)
  var idxPromise = null;
  function loadBooks() {
    if (idxPromise) return idxPromise;
    idxPromise = (async function () {
      if (!window.CalCrypto) return {};
      var k = await CalCrypto.getKey();
      if (!k) return {};
      try {
        var buf = await CalCrypto.decryptUrl(k, home + "books.json.enc");
        var arr = JSON.parse(new TextDecoder().decode(buf));
        var m = {}; arr.forEach(function (b) { m[b.id] = b; }); return m;
      } catch (e) { return {}; }
    })();
    return idxPromise;
  }
  function card(b) {
    var by = esc(b.a || "Unknown");
    var meta = b.s ? '<div class="card__meta">' + esc(b.s) + (b.si ? " · #" + esc(b.si) : "") + "</div>" : "";
    return '<article class="card" data-card>' +
      '<div class="card__cover" style="--spine:' + esc(b.sp || "") + '">' +
        '<a class="card__link" href="' + home + "book/" + b.id + '/" aria-label="Open ' + esc(b.t) + '">' +
          '<img src="' + BLANK + '" data-enc="' + home + "covers/" + b.id + '.jpg.enc" alt="Cover of ' + esc(b.t) + '" decoding="async"></a>' +
        '<button class="bm is-saved" data-bookmark="' + b.id + '" aria-label="Remove from Read Next" aria-pressed="true">' + BM_ICON + "</button>" +
      "</div>" +
      '<a class="card__body" href="' + home + "book/" + b.id + '/"><h3 class="card__title">' + esc(b.t) + "</h3></a>" +
      '<div class="card__by">' + by + "</div>" + meta +
    "</article>";
  }
  async function fill(grid, ids) {
    var books = await loadBooks();
    grid.innerHTML = ids.map(function (id) { var b = books[id]; return b ? card(b) : ""; }).join("");
    Calibrary.wireBookmarks(grid);
    if (Calibrary.applyI18n) Calibrary.applyI18n(grid);
    Calibrary.revealCovers(grid);
  }
  function countText(n) { return Calibrary.t ? Calibrary.t("count.books", { n: n }) : (n + " books"); }

  Calibrary.renderReadNext = async function () {
    if (Calibrary.i18nReady) { try { await Calibrary.i18nReady; } catch (e) {} }
    var ids = Calibrary.bookmarks.list();
    var homeSec = document.querySelector("[data-home-readnext]");
    if (homeSec) {
      var hgrid = homeSec.querySelector("[data-readnext-grid]");
      if (!ids.length) { homeSec.hidden = true; }
      else { homeSec.hidden = false; await fill(hgrid, ids.slice(0, 12)); }
    }
    var full = document.querySelector("[data-readnext-full]");
    if (full) {
      var fgrid = full.querySelector("[data-readnext-grid]");
      var empty = full.querySelector("[data-readnext-empty]");
      var cnt = document.querySelector("[data-readnext-count]");   // lives in the page header
      if (cnt) cnt.textContent = countText(ids.length);
      if (!ids.length) { if (empty) empty.hidden = false; if (fgrid) fgrid.innerHTML = ""; }
      else { if (empty) empty.hidden = true; await fill(fgrid, ids); }
    }
  };

  // wire everything + react to changes
  Calibrary.wireBookmarks(document);
  Calibrary.refreshBadge();
  Calibrary.renderReadNext();
  document.addEventListener("calibrary:bookmarks", function () {
    document.querySelectorAll("[data-bookmark]").forEach(reflect);
    Calibrary.refreshBadge();
    Calibrary.renderReadNext();
  });
  document.addEventListener("calibrary:lang", function () {
    document.querySelectorAll("[data-bookmark]").forEach(reflect);
    Calibrary.renderReadNext();
  });
})();
