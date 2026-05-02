// Sidebar lives in the Electron shell.  Show-sidebar button also lives in
// the shell (electron-app/shell/index.html — #globalShowBtn) — we don't
// render any sidebar-related UI in Next.js anymore.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-screen h-screen overflow-hidden" style={{ background: "#0a0a0c" }}>
      {children}
    </div>
  )
}
