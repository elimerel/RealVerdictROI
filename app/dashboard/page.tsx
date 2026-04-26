import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { getProStatus } from "@/lib/pro";
import DashboardClient, { type DealRow, type PackRow } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!supabaseEnv().configured) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) {
    redirect("/login?redirect=/dashboard");
  }

  const search = await searchParams;
  const justUpgraded = search.checkout === "success";

  const [{ data: deals }, { data: packs }, proStatus] = await Promise.all([
    supabase
      .from("deals")
      .select("id, created_at, address, inputs, results, verdict")
      .order("created_at", { ascending: false }),
    supabase
      .from("negotiation_packs")
      .select(
        "id, share_token, created_at, address, verdict, walk_away_price, list_price, revoked_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    getProStatus(userRes.user.id),
  ]);

  return (
    <DashboardClient
      deals={(deals ?? []) as DealRow[]}
      packs={(packs ?? []) as PackRow[]}
      isPro={proStatus.isPro}
      proStatus={proStatus.status}
      userEmail={userRes.user.email}
      justUpgraded={justUpgraded}
    />
  );
}
