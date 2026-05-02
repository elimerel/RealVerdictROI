import type { Metadata } from "next"
import Sidebar from "@/components/sidebar"

export const metadata: Metadata = {
  title: "RealVerdict",
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Solid background covers the whole window — no desktop bleed-through.
    // Individual glass elements (sidebar, toolbar, panel) use semi-transparent
    // backgrounds on top of this, letting the vibrancy show through locally.
    <div className="flex w-screen h-screen overflow-hidden" style={{ background: "#0d0d0f" }}>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
