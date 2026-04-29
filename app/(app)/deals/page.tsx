import { redirect } from "next/navigation"
import { LayoutList } from "lucide-react"
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
        if (row.inputs && row.results && row.verdict) {
          deals.push(row as SavedDeal)
        }
      }
    }
  }

  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutList className="h-4 w-4" />
          <span>Pipeline</span>
          {deals.length > 0 && (
            <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
              {deals.length}
            </span>
          )}
        </div>
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
