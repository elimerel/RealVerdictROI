"use client"

import { usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { PlusIcon } from "lucide-react"

export function NavMain({
  items,
  onQuickCreate,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
  onQuickCreate?: () => void
}) {
  const pathname = usePathname()
  // Active match: exact path or a sub-route prefix (e.g. /pipeline?stage=watching
  // still highlights Pipeline). Routes whose href is "#" never match.
  const isActiveItem = (url: string) =>
    url !== "#" && (pathname === url || pathname.startsWith(url + "/") || pathname.startsWith(url + "?"))
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip="Add deal"
              onClick={onQuickCreate}
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
            >
              <PlusIcon />
              <span>Add deal</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={isActiveItem(item.url)}
                render={<a href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
