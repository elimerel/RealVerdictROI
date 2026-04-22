import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceRoleClient: SupabaseClient | null | undefined;

/**
 * Service-role Supabase client for trusted server-only paths (Stripe webhook).
 * Returns null when credentials are missing so routes can degrade cleanly.
 */
export function createServiceRoleClient(): SupabaseClient | null {
  if (serviceRoleClient !== undefined) return serviceRoleClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    serviceRoleClient = null;
    return null;
  }

  serviceRoleClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceRoleClient;
}
