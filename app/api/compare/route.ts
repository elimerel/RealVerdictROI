// /api/compare — cross-device comparison queue sync.
//
// GET    → list this user's queue entries
// POST   → upsert one { dealKey, address, inputs }
// DELETE → remove one { dealKey } OR clear everything (no body)
//
// Falls back gracefully:
//   - Supabase not configured   → 503, client stays on localStorage
//   - User not signed in         → 401, client stays on localStorage
//   - Table missing (migration)  → 500 with specific message, client
//                                  logs and stays on localStorage
//
// Deliberately NOT a Server Action so the same endpoints can be called
// from both the /compare page and the "Add to Comparison" button without
// duplicating server-state coupling.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  type DealInputs,
  sanitiseInputs,
} from "@/lib/calculations";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  captureError,
  logEvent,
  withErrorReporting,
} from "@/lib/observability";
import { isPro } from "@/lib/pro";

type UpsertBody = {
  dealKey: string;
  address?: string;
  inputs: DealInputs;
};

type DeleteBody = {
  dealKey?: string;
};

// Shape sent back to the client — mirrors the StoredDeal type used on the
// /compare page so the merge path is zero-cost.
type CompareEntryRow = {
  id: string;
  deal_key: string;
  address: string | null;
  inputs: DealInputs;
  added_at: string;
};

const TABLE_MISSING_HINT =
  "Could not sync compare queue — did you run supabase/migrations/002_compare_entries.sql?";

type AuthGate =
  | { ok: false; response: Response }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
    };

async function requireUser(req: Request): Promise<AuthGate> {
  if (!supabaseEnv().configured) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase is not configured on this deployment." },
        { status: 503 },
      ),
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
    };
  }
  // Reuse the deals-save limiter budget — cross-device sync is a low-volume
  // workflow and a user who genuinely saves 60 deals/hour is an edge case
  // we can absorb.
  const limited = await enforceRateLimit(req, "deals-save", data.user.id);
  if (limited) return { ok: false, response: limited };
  if (!(await isPro(data.user))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Pro subscription required.", code: "pro_required" },
        { status: 402 },
      ),
    };
  }
  return { ok: true, supabase, userId: data.user.id };
}

export const GET = withErrorReporting(
  "api.compare.list",
  async (req: Request) => {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.response;
    const { supabase, userId } = gate;

    const { data, error } = await supabase
      .from("compare_entries")
      .select("id, deal_key, address, inputs, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });

    if (error) {
      captureError(error, {
        area: "api.compare.list",
        extra: { userId, code: error.code },
      });
      return NextResponse.json(
        { error: error.message, hint: TABLE_MISSING_HINT },
        { status: 500 },
      );
    }

    const entries = (data ?? []).map((r: CompareEntryRow) => ({
      id: r.id,
      dealKey: r.deal_key,
      address: r.address ?? undefined,
      inputs: r.inputs,
      addedAt: r.added_at,
    }));
    return NextResponse.json({ entries });
  },
);

export const POST = withErrorReporting(
  "api.compare.upsert",
  async (req: Request) => {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.response;
    const { supabase, userId } = gate;

    let body: UpsertBody;
    try {
      body = (await req.json()) as UpsertBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!body?.dealKey || !body.inputs) {
      return NextResponse.json(
        { error: "Missing dealKey or inputs." },
        { status: 400 },
      );
    }

    // Always re-sanitise on the server so the engine-produced results on
    // the /compare page match what was stored. Client cannot forge inputs.
    const inputs = sanitiseInputs(body.inputs);

    const { data, error } = await supabase
      .from("compare_entries")
      .upsert(
        {
          user_id: userId,
          deal_key: body.dealKey,
          address: body.address?.trim() || null,
          inputs,
        },
        { onConflict: "user_id,deal_key" },
      )
      .select("id, deal_key, address, inputs, added_at")
      .single();

    if (error) {
      captureError(error, {
        area: "api.compare.upsert",
        extra: { userId, code: error.code },
      });
      return NextResponse.json(
        { error: error.message, hint: TABLE_MISSING_HINT },
        { status: 500 },
      );
    }

    logEvent("compare.upsert", { userId });
    const row = data as CompareEntryRow;
    return NextResponse.json({
      entry: {
        id: row.id,
        dealKey: row.deal_key,
        address: row.address ?? undefined,
        inputs: row.inputs,
        addedAt: row.added_at,
      },
    });
  },
);

export const DELETE = withErrorReporting(
  "api.compare.delete",
  async (req: Request) => {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.response;
    const { supabase, userId } = gate;

    let body: DeleteBody = {};
    try {
      // DELETE with no body is valid — treat as "clear all".
      const text = await req.text();
      if (text) body = JSON.parse(text) as DeleteBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const query = supabase
      .from("compare_entries")
      .delete()
      .eq("user_id", userId);
    const { error } = body.dealKey
      ? await query.eq("deal_key", body.dealKey)
      : await query;

    if (error) {
      captureError(error, {
        area: "api.compare.delete",
        extra: { userId, code: error.code },
      });
      return NextResponse.json(
        { error: error.message, hint: TABLE_MISSING_HINT },
        { status: 500 },
      );
    }

    logEvent("compare.delete", {
      userId,
      mode: body.dealKey ? "one" : "all",
    });
    return NextResponse.json({ ok: true });
  },
);
