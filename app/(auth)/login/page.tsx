import { redirect } from "next/navigation"
import { headers } from "next/headers"
import LoginForm from "./LoginForm"
import { supabaseEnv } from "@/lib/supabase/config"
import { getCurrentUser } from "@/lib/supabase/server"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; mode?: string; error?: string; source?: string }>
}) {
  const sp = await searchParams
  const oauthError = sp.error === "oauth_failed"
    ? "Google sign-in failed. Please try again or use email."
    : null
  const redirectTo =
    typeof sp.redirect === "string" && sp.redirect.startsWith("/")
      ? sp.redirect
      : "/browse"
  const initialMode: "signin" | "signup" =
    sp.mode === "signup" ? "signup" : "signin"

  const reqHeaders = await headers()
  const ua = reqHeaders.get("user-agent") ?? ""
  const isElectron =
    reqHeaders.get("x-realverdict-desktop") === "1" ||
    ua.includes("RealVerdictDesktop") ||
    ua.includes("realverdict-desktop") ||
    sp.source === "electron"

  if (isElectron) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen px-5 py-6 dark"
        style={{
          background: "transparent", // window vibrancy reads through
          color:      "rgba(245,245,247,0.95)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {/* Wordmark only — no icon. Matches the in-app chrome's restraint. */}
        <div className="mb-7 flex flex-col items-center gap-1">
          <span
            className="text-[15px] font-semibold tracking-[-0.015em]"
            style={{ color: "rgba(245,245,247,0.96)" }}
          >
            RealVerdict
          </span>
          <span className="text-[11px]" style={{ color: "rgba(235,235,245,0.45)" }}>
            Real estate investing, reimagined
          </span>
        </div>

        {oauthError && (
          <div
            className="mb-3 w-full max-w-xs rounded-[8px] px-3 py-2 text-[11.5px]"
            style={{
              background: "rgba(255,87,87,0.10)",
              border:     "0.5px solid rgba(255,87,87,0.25)",
              color:      "rgba(255,150,150,0.95)",
            }}
          >
            {oauthError}
          </div>
        )}

        {supabaseEnv().configured ? (
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} compact />
        ) : (
          <UnconfiguredNotice />
        )}
      </div>
    )
  }

  const user = await getCurrentUser()
  if (user) redirect(redirectTo)

  // Web (browser) sign-in path. The Electron path above stays compact —
  // it lives inside a small auth window and shouldn't grow chrome. The
  // web path adopts the shadcn login-04 layout: centered Card, BuddyMark
  // hero, all colors via theme tokens (paper / paper-dark works for free).
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-sm">
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-[16px] font-semibold tracking-tight text-foreground">
            RealVerdict
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            {initialMode === "signup" ? "Create your account" : "Sign in to continue"}
          </p>
        </div>

        {supabaseEnv().configured ? (
          <>
            {oauthError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] text-destructive">
                {oauthError}
              </div>
            )}
            <LoginForm redirectTo={redirectTo} initialMode={initialMode} />
          </>
        ) : (
          <UnconfiguredNotice />
        )}
      </div>
    </div>
  )
}

function UnconfiguredNotice() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-[13px] text-amber-700 dark:text-amber-400">
      <h2 className="mb-2 text-[15px] font-semibold">Auth is not configured</h2>
      <p className="leading-relaxed">
        Set{" "}
        <code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code>
        {" "}and{" "}
        <code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        {" "}in your <code className="font-mono">.env.local</code>.
      </p>
    </div>
  )
}
