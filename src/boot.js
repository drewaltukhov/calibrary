// Calibrary — page bootstrap for encrypted shells.
// If unlocked, decrypt this page's payload and render it; else go to login.
(async function () {
  "use strict";
  var payload = document.getElementById("cal-payload");
  var key = await CalCrypto.getKey();
  if (!key || !(await CalCrypto.verify(key))) {
    CalCrypto.clearKey();
    CalCrypto.redirectToLogin();
    return;
  }
  try {
    var html = await CalCrypto.decryptText(key, payload.textContent.trim());
    var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
    document.open();
    document.write(html);
    document.close();
    // document.write doesn't reliably update the tab title — set it explicitly.
    if (tm) { var ta = document.createElement("textarea"); ta.innerHTML = tm[1]; document.title = ta.value; }
  } catch (e) {
    document.body.innerHTML =
      '<p style="font-family:monospace;padding:2rem;color:#26201f">This page could not be decrypted.</p>';
  }
})();
