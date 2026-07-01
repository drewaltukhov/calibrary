// Calibrary — client-side decryption layer (AES-256-GCM).
// Uses native Web Crypto in a secure context (HTTPS / localhost); falls
// back to pure-JS forge otherwise (e.g. plain HTTP on a LAN, iOS Safari).
// The key is derived from the reader's password (PBKDF2) and held only
// in localStorage. Keys/format are identical across both backends.
window.CalCrypto = (function () {
  "use strict";
  var enc = new TextEncoder(), dec = new TextDecoder();
  var KEYNAME = "calibrary:key";
  var SUB = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
  var _keyRaw = null;       // Uint8Array(32)
  var _forgeReady = null;

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
  function bytesToBin(a) { var s = ""; a = new Uint8Array(a); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; }
  function binToBytes(s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

  // ---- forge fallback (loaded on demand) ------------------------------
  function ensureForge() {
    if (window.forge) return Promise.resolve(window.forge);
    if (_forgeReady) return _forgeReady;
    _forgeReady = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = (cfg().home || "") + "assets/forge.min.js";
      s.onload = function () { res(window.forge); };
      s.onerror = function () { rej(new Error("crypto fallback failed to load")); };
      document.head.appendChild(s);
    });
    return _forgeReady;
  }

  // ---- key derivation -> raw 32 bytes ---------------------------------
  async function deriveKeyRaw(password) {
    var salt = b64ToBytes(cfg().salt), iters = cfg().iters;
    if (SUB) {
      var base = await SUB.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
      var bits = await SUB.deriveBits({ name: "PBKDF2", salt: salt, iterations: iters, hash: "SHA-256" }, base, 256);
      return new Uint8Array(bits);
    }
    var forge = await ensureForge();
    return await new Promise(function (res, rej) {
      forge.pkcs5.pbkdf2(password, bytesToBin(salt), iters, 32, forge.md.sha256.create(), function (err, dk) {
        if (err) rej(err); else res(binToBytes(dk));
      });
    });
  }

  // ---- AES-GCM decrypt (bytes: iv|ciphertext|tag) -> Uint8Array -------
  async function decryptBytes(rawKey, bytes) {
    bytes = new Uint8Array(bytes);
    var iv = bytes.slice(0, 12), rest = bytes.slice(12);
    if (SUB) {
      var ck = await SUB.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
      var pt = await SUB.decrypt({ name: "AES-GCM", iv: iv }, ck, rest);
      return new Uint8Array(pt);
    }
    var forge = await ensureForge();
    var ct = rest.slice(0, rest.length - 16), tag = rest.slice(rest.length - 16);
    var d = forge.cipher.createDecipher("AES-GCM", bytesToBin(rawKey));
    d.start({ iv: bytesToBin(iv), tag: forge.util.createBuffer(bytesToBin(tag)) });
    d.update(forge.util.createBuffer(bytesToBin(ct)));
    if (!d.finish()) throw new Error("decrypt failed");
    return binToBytes(d.output.getBytes());
  }

  async function verify(rawKey) {
    try { return dec.decode(await decryptBytes(rawKey, b64ToBytes(cfg().check))) === "calibrary"; }
    catch (e) { return false; }
  }
  async function decryptText(rawKey, b64) { return dec.decode(await decryptBytes(rawKey, b64ToBytes(b64))); }
  async function decryptUrl(rawKey, url) {
    var buf = await (await fetch(url)).arrayBuffer();
    return decryptBytes(rawKey, new Uint8Array(buf));
  }
  async function decryptUrlToBlob(rawKey, url, type) {
    return new Blob([await decryptUrl(rawKey, url)], { type: type || "application/octet-stream" });
  }

  // ---- stored key (base64 of raw bytes) in localStorage --------------
  function storeKey(b64) { try { localStorage.setItem(KEYNAME, b64); } catch (e) {} }
  function clearKey() { try { localStorage.removeItem(KEYNAME); } catch (e) {} _keyRaw = null; }
  async function getKey() {
    if (_keyRaw) return _keyRaw;
    var b; try { b = localStorage.getItem(KEYNAME); } catch (e) { b = null; }
    if (!b) return null;
    _keyRaw = b64ToBytes(b);
    return _keyRaw;
  }
  // login flow calls: deriveKey -> verify -> exportKey -> storeKey
  async function deriveKey(password) { return deriveKeyRaw(password); }
  function exportKey(rawKey) { return bytesToB64(rawKey); }

  function redirectToLogin() {
    var ret = encodeURIComponent(location.pathname + location.search);
    location.replace((cfg().login || "login/") + "?return=" + ret);
  }

  return {
    deriveKey, exportKey, decryptBytes, decryptText, decryptUrl, decryptUrlToBlob,
    verify, storeKey, clearKey, getKey, redirectToLogin,
  };
})();
