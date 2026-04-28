import { SidebarProvider } from "@/components/ui/sidebar"
import { ElectronExpand } from "@/app/(app)/components/electron-expand"
import { SidebarDataLoader } from "@/app/(app)/components/sidebar-data-loader"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <ElectronExpand />
      <SidebarDataLoader />
      <main className="flex-1 overflow-auto">{children}</main>
    </SidebarProvider>
  )
}
