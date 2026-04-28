import { BarChart3 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"

export default function InsightsPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>Market Insights</span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <BarChart3 className="h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">Market Insights</p>
          <p className="text-xs opacity-60 max-w-xs">
            Coming soon — market trends and analytics for your target markets.
          </p>
        </div>
      </div>
    </SidebarInset>
  )
}
