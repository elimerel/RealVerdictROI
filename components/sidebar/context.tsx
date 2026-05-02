"use client"

import { createContext, useContext } from "react"

interface SidebarCtx {
  open: boolean
  toggle: () => void
}

export const SidebarContext = createContext<SidebarCtx>({
  open: true,
  toggle: () => {},
})

export const useSidebar = () => useContext(SidebarContext)
