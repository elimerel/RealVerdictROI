import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { LayoutDashboard } from "lucide-react"

export default function DashboardLoading() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutDashboard className="h-4 w-4" />
          <span>Dashboard</span>
        </div>
      </header>

      <div className="p-6 space-y-6 animate-pulse">
        {/* Page title */}
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-64 rounded-md bg-muted/60" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-muted/40" />
          ))}
        </div>

        {/* Table / list skeleton */}
        <div className="space-y-2">
          <div className="h-5 w-24 rounded-md bg-muted/60" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40" />
          ))}
        </div>
      </div>
    </SidebarInset>
  )
}
