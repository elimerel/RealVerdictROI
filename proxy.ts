import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/config";

/**
 * Next.js 16 renamed `middleware` to `proxy`. This runs before every matched
 * request and refreshes the Supabase auth session cookies so downstream
 * server components see an up-to-date user.
 *
 * Without this, tokens eventually expire and `getUser()` starts returning
 * null even though the user is "logged in".
 */
export async function proxy(request: NextRequest) {
  const env = supabaseEnv();
  // No Supabase configured? Just pass through. The app still works without
  // auth features.
  if (!env.configured) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url!, env.anonKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Touching getUser is what actually triggers the cookie refresh.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on everything that might render UI or hit auth-gated APIs, but skip
  // static assets and Next.js internals for speed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
