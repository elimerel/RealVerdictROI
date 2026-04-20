import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";

export async function POST(req: Request) {
  if (!supabaseEnv().configured) {
    return NextResponse.json({ ok: true });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Honour a ?next= param so we can return the user where they came from.
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";
  return NextResponse.redirect(new URL(next, req.url), { status: 303 });
}
