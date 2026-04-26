"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Search, Inbox, BarChart3, Settings, TrendingUp, Globe } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const navItems = [
  { title: "Search",          icon: Search,   href: "/" },
  { title: "Research",        icon: Globe,    href: "/research" },
  { title: "Leads Inbox",     icon: Inbox,    href: "/leads",    badge: null },
  { title: "Market Insights", icon: BarChart3, href: "/insights" },
  { title: "Settings",        icon: Settings,  href: "/settings" },
]

type Props = {
  userEmail?: string
  isPro?: boolean
  dealCount?: number
}

export function AppSidebar({ userEmail, isPro, dealCount }: Props) {
  const pathname = usePathname()
  const initials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : "—"

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-14 flex items-center px-4 border-b border-sidebar-border">
        <Link
          href="/"
          className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
            <TrendingUp className="h-4 w-4 text-background" />
          </div>
          <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
            RealVerdictROI
          </span>
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
                const badge = item.href === "/leads" && dealCount ? dealCount : null
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "relative",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {badge != null && (
                        <Badge
                          variant="secondary"
                          className="ml-auto h-5 min-w-5 px-1.5 text-[10px] font-medium bg-foreground/10 text-foreground group-data-[collapsible=icon]:hidden"
                        >
                          {badge}
                        </Badge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground shrink-0">
            {initials}
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden min-w-0">
            <span className="text-xs font-medium truncate">{userEmail ?? "Guest"}</span>
            <span className="text-[10px] text-muted-foreground">
              {isPro ? "Pro Plan" : "Free Plan"}
            </span>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
