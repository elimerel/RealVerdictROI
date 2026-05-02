import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Browse · RealVerdict",
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden">
      {children}
    </div>
  )
}
