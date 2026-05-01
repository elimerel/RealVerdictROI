"use client"

/**
 * Invisible component mounted inside the (app) layout.
 * When any authenticated app page loads in Electron, this calls
 * window.electronAPI.signedIn() which tells the main process to expand
 * the window from login-size (420x560) to full app size (1400x900).
 *
 * This is more reliable than watching navigation events in main.js because
 * it fires from the page itself, regardless of how the user signed in
 * (email/password, Google OAuth, or auto-session restore).
 */
import { useEffect } from "react"
import "@/lib/electron"

export function ElectronExpand() {
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : null
    if (api?.signedIn) void api.signedIn()
  }, [])
  return null
}
