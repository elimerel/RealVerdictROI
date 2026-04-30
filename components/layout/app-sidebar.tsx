"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { LayoutList, Settings, LogOut, ChevronUp, Globe, Zap } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"

const navItems = [
  { title: "Browse",   icon: Globe,      href: "/research", hint: "Underwrite as you browse" },
  { title: "Pipeline", icon: LayoutList, href: "/deals",    hint: "Saved properties" },
  { title: "Settings", icon: Settings,   href: "/settings", hint: undefined },
]

type Props = {
  userEmail?: string
  isPro?: boolean
}

export function AppSidebar({ userEmail, isPro }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const initials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : "—"

  const api = typeof window !== "undefined" ? (window as any).electronAPI : null

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    if (api?.signedOut) {
      api.signedOut()
    } else {
      router.push("/login")
      router.refresh()
    }
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      {/* Header — drag region for macOS; traffic lights sit above this zone */}
      <SidebarHeader className="pt-7 pb-3 flex items-center px-3 border-b border-sidebar-border select-none drag-region">
        <Link
          href="/research"
          className="no-drag-region flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center"
        >
          {/* Logo mark — indigo signal tower */}
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
            style={{ background: "oklch(0.62 0.22 265)" }}
          >
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-bold text-[13px] tracking-tight text-foreground leading-none">
              RealVerdict
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href))
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "relative transition-all duration-150",
                        isActive
                          ? "text-foreground font-medium"
                          : "text-sidebar-foreground/60 hover:text-sidebar-foreground/90",
                      )}
                      style={isActive ? {
                        background: "oklch(0.62 0.22 265 / 12%)",
                        borderLeft: "2px solid oklch(0.62 0.22 265)",
                      } : { borderLeft: "2px solid transparent" }}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center">
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: "oklch(0.62 0.22 265 / 20%)", color: "oklch(0.62 0.22 265)" }}
              >
                {initials}
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden min-w-0 flex-1">
                <span className="text-xs font-medium truncate">{userEmail ?? "Guest"}</span>
                <span className="text-[10px] text-muted-foreground/50">
                  {isPro ? (
                    <span className="text-emerald-500/70">Pro</span>
                  ) : "Free"}
                </span>
              </div>
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-data-[collapsible=icon]:hidden" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56 mb-1">
            <div className="px-2 py-1.5">
              <p className="text-xs font-medium truncate">{userEmail ?? "Guest"}</p>
              <p className="text-[10px] text-muted-foreground">{isPro ? "Pro Plan" : "Free Plan"}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={signOut}
              className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
