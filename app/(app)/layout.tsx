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
    <SidebarProvider>
      <ElectronExpand />
      <KeyboardShortcuts />
      <SidebarDataLoader />
      <main className="flex-1 overflow-auto">{children}</main>
    </SidebarProvider>
  )
}
