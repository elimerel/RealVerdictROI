import { redirect } from "next/navigation"
import { BookmarkCheck } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { LeadsClient } from "./LeadsClient"
import type { SavedDeal } from "./SavedDealCard"

export const dynamic = "force-dynamic"

export default async function LeadsPage() {
  const deals: SavedDeal[] = []

  if (supabaseEnv().configured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

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
          <BookmarkCheck className="h-4 w-4" />
          <span>Saved Deals</span>
          {deals.length > 0 && (
            <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
              {deals.length}
            </span>
          )}
        </div>
      </header>
      <LeadsClient deals={deals} />
    </SidebarInset>
  )
}
