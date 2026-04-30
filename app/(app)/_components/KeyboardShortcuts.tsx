"use client"

/**
 * KeyboardShortcuts — global app-level shortcuts.
 *
 * Mounted once inside the (app) layout. Routes ⌘1/2/3 navigation through
 * the Next router; everything else dispatches a CustomEvent on window so
 * page-level components can opt in (e.g. DealsClient listens for
 * "rv:focus-filter" and the research page listens for "rv:focus-url").
 *
 * Why CustomEvents instead of a shared store: each surface owns the
 * targeting logic for what to focus / dismiss. Decoupling via events
 * keeps this file a pure dispatcher with no knowledge of page internals.
 */

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

export type ShortcutEvent =
  | "rv:focus-search"
  | "rv:focus-filter"
  | "rv:focus-url"
  | "rv:escape"

/**
 * Window event helpers — typed wrappers for `window.dispatchEvent` /
 * `addEventListener`. Pages import this type when subscribing.
 */
declare global {
  interface WindowEventMap {
    "rv:focus-search": CustomEvent
    "rv:focus-filter": CustomEvent
    "rv:focus-url":    CustomEvent
    "rv:escape":       CustomEvent
  }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Use ⌘ on macOS, Ctrl elsewhere. The Electron app is Mac-first but
      // the same component runs in the web fallback and on Windows builds.
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod) {
        // Esc has no modifier — handle it standalone.
        if (e.key === "Escape") {
          window.dispatchEvent(new CustomEvent("rv:escape"))
        }
        return
      }

      // Don't swallow shortcuts when the user is typing in an input — let
      // the OS / browser handle Cmd+A, Cmd+Z, etc. naturally.
      const target = e.target as HTMLElement | null
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable

      // ⌘1/2/3 — top-level nav. We allow these even from inputs because
      // they're navigation shortcuts and not typing-adjacent.
      if (e.key === "1") { e.preventDefault(); router.push("/research"); return }
      if (e.key === "2") { e.preventDefault(); router.push("/deals");    return }
      if (e.key === "3") { e.preventDefault(); router.push("/settings"); return }

      // ⌘, → Settings (macOS preferences convention).
      if (e.key === ",") { e.preventDefault(); router.push("/settings"); return }

      if (isEditable) return

      // ⌘N → focus URL bar in browse mode, search bar in pipeline.
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        if (pathname.startsWith("/research")) {
          window.dispatchEvent(new CustomEvent("rv:focus-url"))
        } else if (pathname.startsWith("/deals")) {
          window.dispatchEvent(new CustomEvent("rv:focus-search"))
        } else {
          router.push("/research")
        }
        return
      }

      // ⌘F → filter input on pipeline.
      if (e.key.toLowerCase() === "f") {
        if (pathname.startsWith("/deals")) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent("rv:focus-filter"))
        }
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router, pathname])

  return null
}
