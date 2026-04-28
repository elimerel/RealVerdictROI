"use client"

/**
 * Renders AppSidebar immediately (with placeholder state), then fetches
 * user / pro-status from the client and updates the sidebar.
 *
 * This replaces the server-side data fetching that used to block the layout
 * from streaming.  With this approach the sidebar (and the full page shell)
 * appear in one fast paint; the footer user-pill updates ~200 ms later once
 * the Supabase client call returns.
 */
import { useState, useEffect } from "react"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { createClient } from "@/lib/supabase/client"

function rowIsPro(row: { status: string; current_period_end: string | null } | null): boolean {
  if (!row) return false
  const ok = row.status === "active" || row.status === "trialing"
  if (!ok) return false
  if (!row.current_period_end) return true
  const end = Date.parse(row.current_period_end)
  return Number.isFinite(end) && end > Date.now()
}

export function SidebarDataLoader() {
  const [userEmail, setUserEmail] = useState<string | undefined>()
  const [isPro, setIsPro] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email)

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle()

      setIsPro(rowIsPro(sub as { status: string; current_period_end: string | null } | null))
    })
  }, [])

  return <AppSidebar userEmail={userEmail} isPro={isPro} />
}
