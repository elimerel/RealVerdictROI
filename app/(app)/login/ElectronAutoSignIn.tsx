"use client"

import { useEffect } from "react"

/**
 * Rendered inside the Electron login window when the user is already
 * authenticated (e.g. after an app restart with a live Supabase session).
 *
 * A Next.js redirect() here would load the full app inside the small
 * 400×520 login window. Instead we signal the main process via IPC so it
 * opens the real mainWindow and closes this window cleanly.
 */
export default function ElectronAutoSignIn() {
  useEffect(() => {
    const api = typeof window !== "undefined" ? (window as any).electronAPI : null
    if (api?.signedIn) {
      api.signedIn()
    }
  }, [])

  // Blank dark screen — visible only for the ~100ms before the main process
  // swaps windows, so it never looks like a flash of content.
  return <div className="min-h-screen bg-[#09090b]" />
}
