import type { Metadata } from "next"
import Sidebar from "@/components/sidebar"

export const metadata: Metadata = {
  title: "RealVerdict",
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
