import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { getProStatus } from "@/lib/pro"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let userEmail: string | undefined
  let isPro = false
  let dealCount: number | undefined

  if (supabaseEnv().configured) {
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        userEmail = user.email
        const [pro, { count }] = await Promise.all([
          getProStatus(user.id),
          supabase.from("deals").select("id", { count: "exact", head: true }),
        ])
        isPro = pro.isPro
        dealCount = count ?? undefined
      }
    } catch {
      // Non-fatal — sidebar shows guest state
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar userEmail={userEmail} isPro={isPro} dealCount={dealCount} />
      <main className="flex-1 overflow-auto">{children}</main>
    </SidebarProvider>
  )
}
