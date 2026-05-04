"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Sidebar from "@/components/sidebar"
import { SidebarProvider, useSidebar } from "@/components/sidebar/context"
import SidebarToggle from "@/components/sidebar/toggle"
import { PanelStateProvider } from "@/components/panel/context"
// PanelToggle is no longer mounted at app-layout level — it lives inline
// inside the Toolbar now, so it sits naturally in the chrome.
import CommandPalette from "@/components/command-palette"
import ToastHost from "@/components/ToastHost"

/**
 * Wires menu-accelerator IPC events from main.js into the React tree:
 *   shortcut:navigate       — route push to a top-level page
 *   shortcut:toggle-sidebar — toggle the left rail
 * Other shortcut events (save, reanalyze, open-palette) are handled by
 * the components that own that state.
 */
function ShortcutHost() {
  const router = useRouter()
  const { toggle } = useSidebar()
  useEffect(() => {
    const off = window.__rvOnShortcut?.((kind, arg) => {
      if (kind === "navigate" && typeof arg === "string") router.push(arg)
      else if (kind === "toggle-sidebar") toggle()
    })
    return () => { off?.() }
  }, [router, toggle])
  return null
}

/** Live theme hydrator. Listens for theme:changed broadcasts from main
 *  (sent on user picks, system-theme flips when in System mode, and on
 *  startup) and updates the <html> class set so the token overrides
 *  apply across the whole app. The pre-paint THEME_SCRIPT in
 *  app/layout.tsx handles the FIRST frame; this handles every change
 *  after that. */
function ThemeHydrator() {
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.onThemeChanged) return
    // On mount, ask main for the persisted theme — covers the case where
    // the user changed the theme in another window or on a previous run.
    api.getTheme?.().then((t) => { if (t) applyThemeClass(t.resolved, t.picked) }).catch(() => {})
    const off = api.onThemeChanged(({ picked, resolved }) => {
      applyThemeClass(resolved, picked)
    })
    return () => { off?.() }
  }, [])
  return null
}

/** RouteFader — soft cross-fade + tiny Y-translate when the user
 *  navigates between top-level surfaces (Browse / Pipeline / Settings).
 *  Keyed on pathname so each surface gets its own mount cycle, with the
 *  CSS animation re-running on every key change. The motion is short
 *  (180ms) and small (4px) — present enough that surface swaps feel
 *  intentional, quiet enough that it never feels like the app is
 *  showing off. Same easing as the rest of the chrome. */
function RouteFader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="flex flex-col flex-1 min-h-0 rv-route-fade"
    >
      {children}
    </div>
  )
}

/** Mirror the THEME_SCRIPT logic at runtime. Called on every
 *  theme:changed broadcast. Writes to localStorage as the pre-paint
 *  hint for the next mount. */
function applyThemeClass(resolved: string, picked?: string) {
  const cls = document.documentElement.classList
  cls.remove("theme-charcoal-warm", "theme-charcoal-cinema", "theme-light")
  if (resolved === "charcoal-warm") cls.add("theme-charcoal-warm")
  if (resolved === "light")         cls.add("theme-light")
  if (resolved === "light") cls.remove("dark"); else cls.add("dark")
  if (picked) {
    try { localStorage.setItem("rv-theme", picked) } catch { /* private mode */ }
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PanelStateProvider>
        <ShortcutHost />
        <ThemeHydrator />
        <div
          className="flex w-screen h-screen overflow-hidden"
          style={{ background: "var(--rv-bg)" }}
        >
          <Sidebar />
          <main className="flex flex-col flex-1 min-w-0 h-full relative">
            <RouteFader>{children}</RouteFader>
          </main>
        </div>
        <SidebarToggle />
        <CommandPalette />
        {/* Buddy toast surface — bottom-right. The buddy's voice in
            the moment (saved, stage moved, price drop, etc.). */}
        <ToastHost />
      </PanelStateProvider>
    </SidebarProvider>
  )
}
