import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";

export type ProStatus = {
  isPro: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
};

type SubscriptionRow = {
  status: string;
  current_period_end: string | null;
};

function rowIsPro(row: SubscriptionRow | null): boolean {
  if (!row) return false;
  const ok =
    row.status === "active" || row.status === "trialing";
  if (!ok) return false;
  if (!row.current_period_end) return true;
  const end = Date.parse(row.current_period_end);
  return Number.isFinite(end) && end > Date.now();
}

export const getProStatus = cache(async (userId: string): Promise<ProStatus> => {
  if (!supabaseEnv().configured) {
    return { isPro: false, status: null, currentPeriodEnd: null };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return { isPro: false, status: null, currentPeriodEnd: null };
    }
    const row = data as SubscriptionRow;
    return {
      isPro: rowIsPro(row),
      status: row.status,
      currentPeriodEnd: row.current_period_end,
    };
  } catch {
    return { isPro: false, status: null, currentPeriodEnd: null };
  }
});

export async function isPro(user: Pick<User, "id"> | null): Promise<boolean> {
  if (!user) return false;
  const s = await getProStatus(user.id);
  return s.isPro;
}
