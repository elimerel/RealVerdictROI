import { redirect } from "next/navigation"
import { headers } from "next/headers"
import LoginForm from "./LoginForm"
import { supabaseEnv } from "@/lib/supabase/config"
import { getCurrentUser } from "@/lib/supabase/server"
import { BuddyMark } from "@/components/BuddyMark"

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
        className="relative flex flex-col items-center justify-center min-h-screen px-5 py-6 dark"
        style={{
          background: "transparent", // window vibrancy reads through
          color:      "rgba(245,245,247,0.95)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {/* Drag strip — covers the full top 42px of the window so the
            user can move the Electron login window like any normal Mac
            app (titleBarStyle is hiddenInset, so without an explicit
            drag region the window is undraggable). Inputs + buttons
            below this strip carry their own no-drag implicitly (native
            elements). */}
        <div
          className="absolute top-0 left-0 right-0 h-[42px]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Brand stack — BuddyMark + wordmark + serif tagline. The
            mark gets a moment of presence (with the breathing
            animation built into BuddyMark) before the user touches
            the form. Serif tagline matches the Browse start-screen's
            voice — "Good afternoon, Eli" lives in the same family. */}
        <div className="mb-9 flex flex-col items-center gap-3 relative">
          <BuddyMark size={36} state="rest" tone="primary" />
          <div className="flex flex-col items-center gap-1.5">
            <span
              className="text-[18px] font-semibold tracking-[-0.018em]"
              style={{ color: "rgba(245,245,247,0.96)" }}
            >
              RealVerdict
            </span>
            <span
              className="text-[13px] italic"
              style={{
                fontFamily: "var(--rv-font-display), Georgia, serif",
                color:      "rgba(235,235,245,0.55)",
                letterSpacing: "-0.005em",
              }}
            >
              Pick up where you left off.
            </span>
          </div>
        </div>

        {oauthError && (
          <div
            className="mb-3 w-full max-w-xs rounded-[8px] px-3 py-2 text-[11.5px] relative"
            style={{
              background: "rgba(255,87,87,0.10)",
              border:     "0.5px solid rgba(255,87,87,0.25)",
              color:      "rgba(255,150,150,0.95)",
            }}
          >
            {oauthError}
          </div>
        )}

        <div className="relative w-full flex flex-col items-center">
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

  // Web (browser) sign-in path. The Electron path above stays compact —
  // it lives inside a small auth window and shouldn't grow chrome. The
  // web path adopts the shadcn login-04 layout: centered Card, BuddyMark
  // hero, all colors via theme tokens (paper / paper-dark works for free).
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-7">
        <div className="flex flex-col items-center gap-3">
          <BuddyMark size={36} state="rest" tone="primary" />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-[18px] font-semibold tracking-[-0.018em] text-foreground">
              RealVerdict
            </h1>
            <p
              className="text-[13px] italic text-muted-foreground"
              style={{
                fontFamily: "var(--rv-font-display), Georgia, serif",
                letterSpacing: "-0.005em",
              }}
            >
              {initialMode === "signup"
                ? "Your junior analyst is waiting."
                : "Pick up where you left off."}
            </p>
          </div>
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
