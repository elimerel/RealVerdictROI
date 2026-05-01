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
      {/* h-full + overflow-hidden: <main> exactly fills the body, and
          the page itself never scrolls. Children (Pipeline list,
          dossier, browse webview) own their scroll regions and the
          sticky header / chrome strip at the top of each page stays
          fixed. Previously this used flex-1 which only worked when the
          parent was display:flex — since body is a regular block,
          flex-1 collapsed to 0 and the SidebarProvider's min-h-svh
          took over, letting the whole page scroll past the chrome. */}
      <main className="h-full w-full overflow-hidden flex flex-col min-h-0 min-w-0">
        {children}
      </main>
    </SidebarProvider>
  )
}
