// Calibrary — client-side decryption layer (Web Crypto, AES-GCM).
// The library is AES-encrypted at rest; the key is derived from the
// reader's password (PBKDF2) and held only in sessionStorage.
window.CalCrypto = (function () {
  "use strict";
  var enc = new TextEncoder(), dec = new TextDecoder();
  var KEYNAME = "calibrary:key";
  var _key = null;

  function cfg() { return window.CAL || {}; }
  function b64ToBytes(b64) {
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function bytesToB64(bytes) {
    var s = "", a = new Uint8Array(bytes);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }

  async function deriveKey(password) {
    var base = await crypto.subtle.importKey("raw", enc.encode(password),
      { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64ToBytes(cfg().salt), iterations: cfg().iters, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function exportKey(key) { return bytesToB64(await crypto.subtle.exportKey("raw", key)); }
  async function importRaw(b64) {
    return crypto.subtle.importKey("raw", b64ToBytes(b64), { name: "AES-GCM" }, true, ["decrypt"]);
  }
  async function decryptBytes(key, bytes) {
    var iv = bytes.slice(0, 12), ct = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
  }
  async function verify(key) {
    try { return dec.decode(await decryptBytes(key, b64ToBytes(cfg().check))) === "calibrary"; }
    catch (e) { return false; }
  }
  async function decryptText(key, b64) { return dec.decode(await decryptBytes(key, b64ToBytes(b64))); }
  async function decryptUrl(key, url) {
    var buf = await (await fetch(url)).arrayBuffer();
    return decryptBytes(key, new Uint8Array(buf));
  }
  async function decryptUrlToBlob(key, url, type) {
    return new Blob([await decryptUrl(key, url)], { type: type || "application/octet-stream" });
  }

  // Persisted in localStorage so the passphrase is remembered across
  // visits. A stale key (passphrase or build salt changed) fails
  // verify() in boot.js and is cleared, prompting login again.
  function storeKey(b64) { try { localStorage.setItem(KEYNAME, b64); } catch (e) {} }
  function clearKey() { try { localStorage.removeItem(KEYNAME); } catch (e) {} _key = null; }
  async function getKey() {
    if (_key) return _key;
    var b; try { b = localStorage.getItem(KEYNAME); } catch (e) { b = null; }
    if (!b) return null;
    _key = await importRaw(b);
    return _key;
  }
  function redirectToLogin() {
    var ret = encodeURIComponent(location.pathname + location.search);
    location.replace((cfg().login || "login/") + "?return=" + ret);
  }

  return {
    deriveKey, exportKey, importRaw, decryptBytes, decryptText,
    decryptUrl, decryptUrlToBlob, verify, storeKey, clearKey, getKey, redirectToLogin,
  };
})();
