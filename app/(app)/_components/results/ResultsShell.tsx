import type { CSSProperties } from "react"

export function ResultsShell({
  children,
  style,
}: {
  children: React.ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={style} className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {children}
    </div>
  )
}
