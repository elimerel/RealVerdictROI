import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { withErrorReporting, logEvent, captureError } from "@/lib/observability";

export const DELETE = withErrorReporting(
  "api.deals-delete",
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    if (!supabaseEnv().configured) {
      return NextResponse.json(
        { error: "Supabase is not configured on this deployment." },
        { status: 503 },
      );
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: "Missing deal id." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    // RLS enforces ownership — a delete on a row that belongs to another user
    // silently matches 0 rows rather than throwing an error, so we check count.
    const { error, count } = await supabase
      .from("deals")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("user_id", userRes.user.id);

    if (error) {
      captureError(error, {
        area: "api.deals-delete",
        extra: { dealId: id, userId: userRes.user.id },
      });
      return NextResponse.json(
        { error: `Could not delete deal: ${error.message}` },
        { status: 500 },
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: "Deal not found or you don't have permission to delete it." },
        { status: 404 },
      );
    }

    logEvent("deals.delete", { userId: userRes.user.id, dealId: id });
    return NextResponse.json({ deleted: true });
  },
);
