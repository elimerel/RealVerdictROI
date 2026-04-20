/**
 * Centralised check for whether Supabase env vars are present.
 * Keep this pure so it can run in both server and client contexts without
 * accidentally importing Supabase SDK code into every bundle.
 */

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    url,
    anonKey,
    configured: !!url && !!anonKey,
  };
}
