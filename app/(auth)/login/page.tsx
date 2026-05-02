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
      <div className="flex flex-col min-h-screen bg-[var(--p-bg)]">
        {/* Drag zone — makes the window draggable in hiddenInset titlebar mode */}
        <div
          className="h-8 w-full shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      <div className="flex flex-col items-center justify-center flex-1 px-5 pb-8">
        <div className="mb-6 flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--accent)]"
            style={{ boxShadow: "0 1px 3px var(--accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)" }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill="white" strokeWidth="0"/>
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-[var(--p-t1)] tracking-tight">
            RealVerdict
          </span>
        </div>

        {oauthError && (
          <div className="mb-3 w-full max-w-xs rounded-lg border border-[var(--bad)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--bad)]">
            {oauthError}
          </div>
        )}

        {supabaseEnv().configured ? (
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} compact />
        ) : (
          <UnconfiguredNotice />
        )}
      </div>
      </div>
    )
  }

  const user = await getCurrentUser()
  if (user) redirect(redirectTo)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--f-bg)] px-6 py-16">
      <div className="mb-8 flex items-center gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--accent)]"
          style={{ boxShadow: "0 1px 4px var(--accent-border)" }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill="white" strokeWidth="0"/>
          </svg>
        </div>
        <span className="text-[15px] font-semibold text-[var(--f-t1)] tracking-tight">RealVerdict</span>
      </div>

      {supabaseEnv().configured ? (
        <>
          {oauthError && (
            <div className="mb-4 w-full max-w-md rounded-lg border border-[var(--bad)] bg-[var(--bad-bg)] px-4 py-3 text-sm text-[var(--bad)]">
              {oauthError}
            </div>
          )}
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} />
        </>
      ) : (
        <UnconfiguredNotice />
      )}
    </div>
  )
}

function UnconfiguredNotice() {
  return (
    <div className="max-w-md rounded-2xl border border-[var(--warn-bg)] bg-[var(--warn-bg)] p-6 text-sm text-[var(--warn)]">
      <h2 className="mb-2 text-base font-semibold">Auth is not configured</h2>
      <p className="leading-relaxed opacity-80">
        Set{" "}
        <code className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>
        {" "}and{" "}
        <code className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        {" "}in your <code>.env.local</code>.
      </p>
    </div>
  )
}
