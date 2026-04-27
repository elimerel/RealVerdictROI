import { redirect } from "next/navigation"
import { Inbox } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { dealRowToLead } from "@/lib/lead-adapter"
import type { DealRow } from "@/lib/lead-adapter"
import { LeadsClient } from "./LeadsClient"

export const dynamic = "force-dynamic"

export default async function LeadsPage() {
  const leads: ReturnType<typeof dealRowToLead>[] = []

  if (supabaseEnv().configured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data: rows } = await supabase
      .from("deals")
      .select("*")
      .order("created_at", { ascending: false })

    if (rows) {
      for (const row of rows as DealRow[]) {
        try {
          leads.push(dealRowToLead(row))
        } catch {
          // skip malformed rows
        }
      }
    }
  }

  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" />
          <span>Leads Inbox</span>
          {leads.length > 0 && (
            <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
              {leads.length}
            </span>
          )}
        </div>
      </header>
      <LeadsClient leads={leads} />
    </SidebarInset>
  )
}
