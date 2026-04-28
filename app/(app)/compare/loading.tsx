import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { GitCompareArrows } from "lucide-react"

export default function CompareLoading() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitCompareArrows className="h-4 w-4" />
          <span>Compare Deals</span>
        </div>
      </header>

      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-7 w-44 rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-xl border border-border bg-muted/40" />
          ))}
        </div>
      </div>
    </SidebarInset>
  )
}
