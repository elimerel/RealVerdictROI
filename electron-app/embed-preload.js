// Embedded-browser preload — runs BEFORE any page script in every
// WebContentsView (Zillow, Redfin, etc.). Patches the most common
// fingerprint signals that bot-detection systems (Cloudflare Turnstile,
// PerimeterX, kasada) check first.
//
// Combined with the `--disable-blink-features=AutomationControlled`
// switch in main.js, this is the basic anti-fingerprint setup that
// keeps real-estate sites from immediately flagging the embed as an
// automated browser. Won't beat aggressive captchas — Turnstile has
// many other checks — but reduces false-positives on routine browsing.
//
// IMPORTANT: this preload exposes NO IPC bridge. It must NEVER call
// contextBridge.exposeInMainWorld or otherwise leak Electron internals
// to the visited site — that would be a serious security vector.

"use strict"

;(function patchAntiFingerprint() {
  try {
    // navigator.webdriver === true is the single biggest tell. Override
    // the getter so any read returns undefined regardless of how
    // Chromium / Electron set the underlying property.
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
      configurable: true,
    })
  } catch { /* defineProperty can throw on some sites that froze navigator */ }

  try {
    // Some detection scripts inspect navigator.plugins.length === 0 as
    // a headless signal. Real Chromes report a few entries. We don't
    // need to fake actual plugins — a non-empty array length is enough
    // to dodge the simple checks.
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
      configurable: true,
    })
  } catch { /* same caveat */ }

  try {
    // navigator.languages [] is another headless tell. Mirror the UA.
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
      configurable: true,
    })
  } catch {}
})()
