// Calibrary — login page. Derives the key, verifies, stores it, and
// forwards to the originally requested page.
(function () {
  "use strict";
  var form = document.getElementById("login-form");
  var input = document.getElementById("pw");
  var err = document.querySelector(".login__error");
  var btn = form.querySelector("button");
  var ret = new URLSearchParams(location.search).get("return");
  function T(key, fb) { return (window.Calibrary && Calibrary.t) ? Calibrary.t(key, { fallback: fb }) : fb; }

  function fail(msg) {
    err.textContent = msg; err.hidden = false;
    btn.disabled = false; btn.textContent = T("login.unlock", "Unlock");
    input.focus(); input.select();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true; btn.textContent = T("login.unlocking", "Unlocking…");
    try {
      var key = await CalCrypto.deriveKey(input.value);
      if (!(await CalCrypto.verify(key))) return fail(T("login.wrong", "That password didn’t open the library."));
      CalCrypto.storeKey(await CalCrypto.exportKey(key));
      var dest = ret ? decodeURIComponent(ret) : "";
      // only allow same-origin absolute/relative paths
      if (!dest || (dest[0] !== "/" && dest[0] !== ".")) dest = (window.CAL && window.CAL.home) || "./";
      location.replace(dest);
    } catch (ex) {
      fail(T("login.error", "Something went wrong unlocking. Please try again."));
    }
  });

  input.focus();
})();
