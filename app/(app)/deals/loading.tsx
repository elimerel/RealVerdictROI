import { LayoutList } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"

export default function DealsLoading() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutList className="h-4 w-4" />
          <span>Deals</span>
        </div>
      </header>
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-muted animate-pulse"
            style={{ opacity: 1 - i * 0.15 }}
          />
        ))}
      </div>
    </SidebarInset>
  )
}
