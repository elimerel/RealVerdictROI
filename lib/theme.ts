// ---------------------------------------------------------------------------
// Theme — applied via a single class on <html>: "dark" | "" | "paper".
// ---------------------------------------------------------------------------
//
// Why class on <html> and not data-theme? The dark theme already lives on
// `.dark` in globals.css and is consumed by every shadcn primitive. Reusing
// that class keeps existing components working unchanged; we just gate
// when it's applied.
//
// SSR strategy: the inline script in app/layout.tsx applies the class
// before first paint so the user never sees a flash of the wrong theme.
// This module is the runtime-side counterpart: when the user picks a new
// theme in Settings it persists the choice and re-applies the class.
// ---------------------------------------------------------------------------

export type Theme = "dark" | "light" | "paper" | "system"

export const THEME_STORAGE_KEY = "rv:theme"

/** Resolve "system" to the OS-preferred concrete theme. Falls back to
 *  dark on the server / when matchMedia is unavailable. */
export function resolveSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined" || !window.matchMedia) return "dark"
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

/** Read the user's saved preference. Returns "system" when none is set. */
export function readTheme(): Theme {
  if (typeof window === "undefined") return "system"
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (raw === "dark" || raw === "light" || raw === "paper" || raw === "system") return raw
  return "system"
}

/** Apply a theme to <html>. Idempotent. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const concrete: "dark" | "light" | "paper" =
    theme === "system" ? resolveSystemTheme() : theme

  // Mutually-exclusive class state — strip both first so we never end up
  // with `dark paper` and surfaces stop being legible.
  root.classList.remove("dark", "paper")
  if (concrete === "dark")  root.classList.add("dark")
  if (concrete === "paper") root.classList.add("paper")
  // Light is the default :root state — no class needed.

  // Hint the browser about UA-controlled controls (scrollbars, form
  // controls). Without this, scrollbars stay dark on a paper background.
  root.style.colorScheme = concrete === "dark" ? "dark" : "light"
}

/** Persist + apply. Call this from the Settings switcher. */
export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
  applyTheme(theme)
}

/** Inline script body — embedded synchronously in <head> so the theme is
 *  applied BEFORE first paint. Keep this self-contained: no imports, no
 *  optional chaining gaps the SSR may not parse. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var s = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var t = (s === "dark" || s === "light" || s === "paper" || s === "system") ? s : "system";
    var concrete = t === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : t;
    var root = document.documentElement;
    root.classList.remove("dark", "paper");
    if (concrete === "dark")  root.classList.add("dark");
    if (concrete === "paper") root.classList.add("paper");
    root.style.colorScheme = concrete === "dark" ? "dark" : "light";
  } catch (e) {
    // localStorage / matchMedia disabled — fall back to dark, our default.
    document.documentElement.classList.add("dark");
  }
})();
`.trim()
