/**
 * Auth layout — intentionally bare.
 * No AppSidebar, no SidebarProvider.  The login page must be fully
 * interactive in the compact Electron window (420×560) where the
 * sidebar would otherwise cover the entire form.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
