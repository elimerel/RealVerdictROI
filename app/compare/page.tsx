// /compare — server shell that decides between anonymous (localStorage)
// and signed-in (Supabase-backed) mode and hands off to CompareClient.
//
// Signed-in users get cross-device sync: their queue round-trips through
// Supabase's compare_entries table (see migrations/002_compare_entries.sql).
// Anonymous users keep the original localStorage-only behavior so nothing
// changes for them.

import type { Metadata } from "next";
import CompareClient from "./CompareClient";
import { supabaseEnv } from "@/lib/supabase/config";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isPro } from "@/lib/pro";

export const metadata: Metadata = {
  title: "Compare deals · RealVerdict",
};

type RemoteEntryRow = {
  id: string;
  deal_key: string;
  address: string | null;
  inputs: unknown;
  added_at: string;
};

export default async function ComparePage() {
  const configured = supabaseEnv().configured;
  const user = configured ? await getCurrentUser() : null;

  if (!user) {
    // Anonymous — client reads localStorage on mount.
    return (
      <CompareClient
        signedIn={false}
        remoteSyncEnabled={false}
        initialRemote={[]}
      />
    );
  }

  const pro = await isPro(user);
  if (!pro) {
    return (
      <CompareClient
        signedIn={true}
        remoteSyncEnabled={false}
        initialRemote={[]}
      />
    );
  }

  // Signed-in Pro — prefetch remote queue on the server so the first paint
  // already shows the user's entries. If the migration hasn't been
  // applied the query returns a 42P01 error and we render empty, letting
  // the client fall through to merge-from-localStorage behavior.
  let initialRemote: RemoteEntryRow[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("compare_entries")
      .select("id, deal_key, address, inputs, added_at")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false });
    if (data) initialRemote = data as RemoteEntryRow[];
  } catch {
    // Table missing or RLS failure — render empty, client will try API
    // routes and surface a sync error if the migration is needed.
  }

  const shaped = initialRemote.map((r) => ({
    id: r.id,
    dealKey: r.deal_key,
    address: r.address ?? undefined,
    inputs: r.inputs as never,
    addedAt: r.added_at,
  }));

  return (
    <CompareClient
      signedIn={true}
      remoteSyncEnabled={true}
      initialRemote={shaped}
    />
  );
}
