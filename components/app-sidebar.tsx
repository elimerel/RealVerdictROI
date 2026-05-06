"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { BuddyMark } from "@/components/BuddyMark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  KanbanSquareIcon,
  CompassIcon,
  Settings2Icon,
  CircleHelpIcon,
} from "lucide-react"

const data = {
  user: {
    name: "RealVerdict",
    email: "you@realverdict.app",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    { title: "Pipeline", url: "/pipeline", icon: <KanbanSquareIcon /> },
    { title: "Browse",   url: "/browse",   icon: <CompassIcon /> },
  ],
  navSecondary: [
    { title: "Settings", url: "/settings", icon: <Settings2Icon /> },
    { title: "Help",     url: "#",         icon: <CircleHelpIcon /> },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter()
  const handleQuickCreate = React.useCallback(() => {
    // Add-deal mode: focused workflow where finding a save-worthy
    // listing IS the goal. Browse with mode=addDeal shows a "you're
    // adding a deal" banner + cancel; saving auto-routes back to
    // Pipeline with the new deal selected. Plain "Browse" stays as
    // free-form exploration without the focused chrome.
    router.push("/browse?mode=addDeal")
  }, [router])

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      {/* SidebarHeader: needs paddingLeft to clear the floating
          SidebarToggle (fixed at window x=86, ~32px wide → ends at
          x=118). Padding 124px keeps the wordmark out from under the
          toggle. Drag region so empty space around the wordmark moves
          the window — the wordmark link opts into no-drag itself. */}
      <SidebarHeader
        style={{
          WebkitAppRegion: "drag",
          paddingLeft:     124,
        } as React.CSSProperties}
      >
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              render={<a href="/pipeline" />}
            >
              <BuddyMark size={20} />
              <span className="text-base font-semibold">RealVerdict</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} onQuickCreate={handleQuickCreate} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
