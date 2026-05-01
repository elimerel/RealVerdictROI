import { SidebarProvider } from "@/components/ui/sidebar"
import { ElectronExpand } from "@/app/(app)/components/electron-expand"
import { SidebarDataLoader } from "@/app/(app)/components/sidebar-data-loader"
import { KeyboardShortcuts } from "@/app/(app)/_components/KeyboardShortcuts"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <ElectronExpand />
      <KeyboardShortcuts />
      <SidebarDataLoader />
      {/* overflow-hidden + flex column: the page itself never scrolls, so
          children (Pipeline list, dossier, browse webview) own their scroll
          regions and the sticky header at the top of each page stays fixed.
          The previous overflow-auto caused the whole window to scroll past
          the header, hitting the literal top of the screen. */}
      <main className="flex-1 overflow-hidden flex flex-col min-h-0 min-w-0">
        {children}
      </main>
    </SidebarProvider>
  )
}
