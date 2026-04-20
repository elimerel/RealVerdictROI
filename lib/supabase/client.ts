"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./config";

/**
 * Browser-side Supabase client. Safe to import from `"use client"` components.
 * Throws if Supabase env vars are missing so misconfigurations surface early
 * rather than silently failing an auth call.
 */
export function createClient() {
  const { url, anonKey, configured } = supabaseEnv();
  if (!configured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart the dev server.",
    );
  }
  return createBrowserClient(url!, anonKey!);
}
