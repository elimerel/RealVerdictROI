"use client"

// useMapStyle — read the user's preferred Mapbox style from
// InvestmentPrefs. Returns the resolved style ID (theme-aware when
// the pref is "auto"). Listens for a custom "rv:prefs-changed" event
// so the persistent MapShell updates live whenever the user picks a
// different style in Settings — no remount, no reload.

import { useEffect, useState } from "react"
import type { MapStyleKey } from "@/lib/electron"

export const PREFS_CHANGED_EVENT = "rv:prefs-changed"

/** Resolve a MapStyleKey to a concrete Mapbox style URL string. The
 *  "auto" case looks at the html element's theme classes — same
 *  signal MapShell already uses for its initial bg pick. */
export function resolveMapStyleUrl(key: MapStyleKey): string {
  if (key === "auto") {
    // theme-paper = light cream, theme-paper-dark = dark canvas. The
    // legacy theme-light class is also still treated as light for any
    // user who hasn't been migrated yet.
    const cls = typeof document !== "undefined"
      ? document.documentElement.classList : null
    const isLight = !!cls && (cls.contains("theme-paper") || cls.contains("theme-light"))
    return isLight
      ? "mapbox://styles/mapbox/light-v11"
      : "mapbox://styles/mapbox/dark-v11"
  }
  return `mapbox://styles/mapbox/${key}`
}

export function useMapStyle(): MapStyleKey {
  const [key, setKey] = useState<MapStyleKey>("auto")
  useEffect(() => {
    let cancelled = false
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.getInvestmentPrefs) return
    const refresh = () => {
      void api.getInvestmentPrefs!().then((p) => {
        if (cancelled) return
        setKey((p.mapStyle as MapStyleKey | undefined) ?? "auto")
      })
    }
    refresh()
    window.addEventListener(PREFS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(PREFS_CHANGED_EVENT, refresh)
    }
  }, [])
  return key
}
