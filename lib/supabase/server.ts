import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./config";

/**
 * Server-side Supabase client. Must be awaited because Next 16 `cookies()`
 * is async. Use from Route Handlers, Server Components, and Server Actions.
 *
 * In Server Components, `cookieStore.set` throws (cookies are read-only
 * there) — the catch is intentional. Session refresh happens in `proxy.ts`,
 * so missing a set call from a Server Component is harmless.
 */
export async function createClient() {
  const { url, anonKey, configured } = supabaseEnv();
  if (!configured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url!, anonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component. Proxy keeps sessions fresh.
        }
      },
    },
  });
}

/**
 * Read the current user in a server context. Returns null when not signed
 * in or when Supabase env is missing so callers don't have to catch.
 */
export async function getCurrentUser() {
  if (!supabaseEnv().configured) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}
