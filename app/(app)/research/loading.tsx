import { Globe } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"

export default function ResearchLoading() {
  return (
    <SidebarInset>
      <div className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-4 w-4" />
          <span>Research</span>
        </div>
      </div>
      <div className="flex-1 bg-muted/20 animate-pulse" />
    </SidebarInset>
  )
}
