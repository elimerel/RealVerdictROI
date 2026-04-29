import { BarChart3 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"

export default function InsightsLoading() {
  return (
    <SidebarInset>
      <div className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>Insights</span>
        </div>
      </div>
      <div className="p-6 space-y-3">
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
      </div>
    </SidebarInset>
  )
}
