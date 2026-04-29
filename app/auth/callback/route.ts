import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * OAuth callback handler.
 * After Google (or any Supabase OAuth provider) redirects back, Supabase
 * sends a one-time `code` in the query string. We exchange it for a session
 * here on the server so the session cookie is set correctly for SSR.
 *
 * The redirect URL registered in both Supabase and Google Cloud Console must
 * be: https://your-domain.com/auth/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  // Where to send the user after sign-in (defaults to /research — the
  // Electron desktop app opens to the Research co-pilot by default).
  const next = searchParams.get("next") ?? "/research"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Ensure we only redirect to same-origin paths
      const redirectTo = next.startsWith("/") ? `${origin}${next}` : `${origin}/research`
      return NextResponse.redirect(redirectTo)
    }
  }

  // Something went wrong — send to login with an error hint
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
}
