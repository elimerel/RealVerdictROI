import { usePathname } from "next/navigation"

/**
 * Returns true when the named top-level route is the one currently
 * visible inside the always-mounted-routes shell (see
 * `app/(app)/layout.tsx` → `AlwaysMountedRoutes`). All three pages
 * (browse / pipeline / settings) are mounted simultaneously and
 * toggled via CSS `visibility`; effects that hold IPC subscriptions,
 * window event listeners, or timers should gate on this hook so
 * they pause work while their route is hidden.
 *
 *   const isActive = useIsActiveRoute("browse")
 *   useEffect(() => {
 *     if (!isActive) return
 *     const off = api.onTabsState(...)
 *     return off
 *   }, [isActive])
 *
 * Browse is the default fallthrough (anything that isn't /pipeline
 * or /settings counts as browse) — within `app/(app)/layout.tsx`
 * the only routes ever rendered are these three, so the fallthrough
 * is a real safety, not a guess.
 */
export function useIsActiveRoute(route: "browse" | "pipeline" | "settings"): boolean {
  const pathname = usePathname()
  if (route === "pipeline") return pathname.startsWith("/pipeline")
  if (route === "settings") return pathname.startsWith("/settings")
  return !pathname.startsWith("/pipeline") && !pathname.startsWith("/settings")
}
