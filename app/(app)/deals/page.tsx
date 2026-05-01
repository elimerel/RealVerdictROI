import { redirect } from "next/navigation"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { isPro } from "@/lib/pro"
import { DealsClient } from "./DealsClient"
import type { SavedDeal } from "./SavedDealCard"

export const dynamic = "force-dynamic"

export default async function DealsPage() {
  const configured = supabaseEnv().configured
  const deals: SavedDeal[] = []
  let isUserPro = false
  let isSignedIn = false

  if (configured) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    isSignedIn = true
    isUserPro = await isPro(user)

    const { data: rows } = await supabase
      .from("deals")
      .select("*")
      .order("created_at", { ascending: false })

    if (rows) {
      for (const row of rows) {
        if (row.inputs && row.results) {
          deals.push(row as SavedDeal)
        }
      }
    }
  }

  return (
    <SidebarInset>
      {/* Page header doubles as the macOS drag area — extends the sidebar's
          drag-region across the full window top so the user can grab the
          window from anywhere along the title bar, not just the sidebar. */}
      <header className="rv-toolbar-strip drag-region h-14 flex items-center gap-3 px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />
        <h1 className="text-[13px] font-semibold tracking-tight text-foreground"
            style={{ letterSpacing: "-0.012em" }}>
          Pipeline
        </h1>
        {deals.length > 0 && (
          <span className="text-[11px] text-muted-foreground/50 font-mono rv-num">
            {deals.length}
          </span>
        )}
      </header>
      <DealsClient
        deals={deals}
        signedIn={isSignedIn}
        isPro={isUserPro}
        supabaseConfigured={configured}
      />
    </SidebarInset>
  )
}
