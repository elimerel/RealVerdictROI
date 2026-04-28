"use client"

import { useLayoutEffect, useState } from "react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import type { CSSProperties } from "react"

/**
 * In Electron: wraps content in SidebarInset so the sidebar stays visible.
 * In web: renders the original dark standalone wrapper.
 */
export function ResultsShell({
  children,
  style,
}: {
  children: React.ReactNode
  style?: CSSProperties
}) {
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    setIsElectron(!!window.electronAPI)
  }, [])

  // During SSR / hydration: render without shell so the page is immediately
  // useful and there's no layout shift on the web version.
  if (!isElectron) {
    return (
      <div style={style} className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        {children}
      </div>
    )
  }

  return (
    <SidebarInset>
      {children}
    </SidebarInset>
  )
}

/**
 * Electron-aware results header. In Electron: compact app-style header with
 * SidebarTrigger. In web: renders nothing (ResultsHeader handles the web case).
 */
export function ElectronResultsHeader() {
  const [isElectron, setIsElectron] = useState(false)

  useLayoutEffect(() => {
    setIsElectron(!!window.electronAPI)
  }, [])

  if (!isElectron) return null

  return (
    <div className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
      <SidebarTrigger className="-ml-1" />
    </div>
  )
}
