import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { BookmarkCheck } from "lucide-react"

export default function LeadsLoading() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookmarkCheck className="h-4 w-4" />
          <span>Saved Deals</span>
        </div>
      </header>

      <div className="p-4 space-y-2 animate-pulse">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="h-20 rounded-lg border border-border bg-muted/40"
          />
        ))}
      </div>
    </SidebarInset>
  )
}
