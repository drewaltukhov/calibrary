// Calibrary — client-side interface translation (EN / RU).
// Dictionaries live in assets/i18n/<lang>.json. Book *content* (titles,
// authors, descriptions) is never translated — only the UI chrome.
window.Calibrary = window.Calibrary || {};
(function () {
  "use strict";
  var LANGS = { en: 1, ru: 1 };
  var LKEY = "calibrary:lang";
  var home = (window.CAL && window.CAL.home) || "";
  var dict = {}, plural = null, lang = "en";

  function detect() {
    try { var s = localStorage.getItem(LKEY); if (s && LANGS[s]) return s; } catch (e) {}
    var n = (navigator.language || "en").toLowerCase();
    return n.indexOf("ru") === 0 ? "ru" : "en";
  }

  function t(key, opts) {
    var v = dict[key];
    if (v == null) return (opts && opts.fallback) || key;
    if (typeof v === "object") {
      var n = opts && opts.n != null ? opts.n : 0;
      var cat = plural ? plural.select(Number(n)) : "other";
      var form = v[cat] != null ? v[cat] : (v.other != null ? v.other : (v.many != null ? v.many : key));
      return String(form).replace("{n}", n);
    }
    if (opts && opts.n != null) return String(v).replace("{n}", opts.n);
    return v;
  }

  function apply(scope) {
    scope = scope || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var n = el.getAttribute("data-n");
      el.textContent = t(el.getAttribute("data-i18n"), n != null ? { n: +n } : undefined);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    scope.querySelectorAll("[data-i18n-al]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-al")));
    });
    scope.querySelectorAll("[data-i18n-genre]").forEach(function (el) {
      var g = (dict.genres || {})[el.getAttribute("data-i18n-genre")];
      if (g != null) el.textContent = g;
    });
  }

  function markToggle() {
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-lang") === lang);
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === lang ? "true" : "false");
    });
  }

  function load(l) {
    return fetch(home + "assets/i18n/" + l + ".json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        dict = d; lang = l;
        try { plural = new Intl.PluralRules(l); } catch (e) { plural = null; }
        document.documentElement.setAttribute("lang", l);
      });
  }

  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  Calibrary.t = t;
  Calibrary.applyI18n = apply;
  Calibrary.getLang = function () { return lang; };
  Calibrary.setLang = function (l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem(LKEY, l); } catch (e) {}
    load(l).then(function () {
      apply(document); markToggle();
      document.dispatchEvent(new CustomEvent("calibrary:lang", { detail: l }));
    });
  };

  lang = detect();
  document.documentElement.setAttribute("lang", lang);
  // language toggle (event-delegated so it survives document.write timing)
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lang]");
    if (b) { e.preventDefault(); Calibrary.setLang(b.getAttribute("data-lang")); }
  });

  Calibrary.i18nReady = load(lang).then(function () {
    whenReady(function () { apply(document); markToggle(); });
  });
})();
