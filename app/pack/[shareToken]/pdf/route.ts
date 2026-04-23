import { renderToStream, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { PackDocument } from "@/lib/pack-pdf";
import type { PackPayload } from "@/lib/negotiation-pack";
import { withErrorReporting, captureError } from "@/lib/observability";

// ---------------------------------------------------------------------------
// GET /pack/[shareToken]/pdf — server-rendered PDF download (HANDOFF §20.3).
//
// Reads the same Supabase row as /pack/[shareToken]/page.tsx (RLS gates the
// access — only public unrevoked rows or owner rows resolve), then streams
// the @react-pdf/renderer output back as application/pdf.
//
// Notes:
//   - Runs on the Node runtime (react-pdf needs Node Buffer + canvas-free
//     primitives that aren't on the edge runtime). Vercel handles this fine.
//   - We slugify the address for a sensible filename so users get
//     "1234-elm-st-springfield-il.pdf" instead of "pdf".
//   - No login walls — same access model as the web view.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorReporting(
  "api.pack-pdf",
  async (
    _req: Request,
    ctx: { params: Promise<{ shareToken: string }> },
  ) => {
    const { shareToken } = await ctx.params;

    if (!supabaseEnv().configured) {
      return new Response("Pack hosting not configured.", { status: 503 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("negotiation_packs")
      .select("payload, address, revoked_at, is_public")
      .eq("share_token", shareToken)
      .maybeSingle();

    if (error || !data) {
      return new Response("Pack not found.", { status: 404 });
    }
    if (data.revoked_at) {
      return new Response("Pack has been revoked.", { status: 410 });
    }

    const payload = data.payload as PackPayload;

    let stream: NodeJS.ReadableStream;
    try {
      // createElement avoids JSX in a `.ts` route file; PackDocument lives
      // in pack-pdf.tsx so the JSX has somewhere legal to live.
      // PackDocument returns a <Document> at the root, so the resulting
      // element IS a DocumentProps element at runtime — react-pdf just
      // can't see through the wrapper component at the type level. Cast.
      const element = createElement(PackDocument, {
        payload,
        fallbackAddress: data.address ?? undefined,
      }) as unknown as ReactElement<DocumentProps>;
      stream = await renderToStream(element);
    } catch (err) {
      captureError(err, {
        area: "api.pack-pdf",
        extra: { stage: "render", shareToken },
      });
      return new Response("Could not render PDF.", { status: 500 });
    }

    const filename = slugifyForFilename(data.address ?? payload.address);

    // ReadableStream.from is broadly available; the cast keeps TypeScript
    // happy across Node and Edge typings.
    const webStream =
      typeof (stream as unknown as { pipe?: unknown }).pipe === "function"
        ? nodeStreamToWebStream(stream)
        : (stream as unknown as ReadableStream<Uint8Array>);

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}.pdf"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  },
);

function slugifyForFilename(input: string | null | undefined): string {
  const fallback = "negotiation-pack";
  if (!input) return fallback;
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function nodeStreamToWebStream(
  node: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk: Buffer | string) => {
        controller.enqueue(
          typeof chunk === "string" ? Buffer.from(chunk) : chunk,
        );
      });
      node.on("end", () => controller.close());
      node.on("error", (err) => controller.error(err));
    },
    cancel() {
      // best-effort: try to destroy the upstream node stream
      const maybeDestroy = (node as unknown as { destroy?: () => void })
        .destroy;
      if (typeof maybeDestroy === "function") maybeDestroy.call(node);
    },
  });
}
