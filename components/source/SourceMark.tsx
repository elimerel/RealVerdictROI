"use client"

import type { SourceKind } from "@/lib/electron"

// ── Source brand-marks ────────────────────────────────────────────────────────
//
// Every number in RealVerdict ties back to a real, namable source. Mercury's
// transactions surface uses real avatar/brand glyphs on each row — we follow
// the same pattern. When the source has a brand identity (Zillow / Redfin /
// FRED / HUD / etc.), we render the actual logo as a tiny image. When it
// doesn't (AI estimate, industry default, user-edited), we fall back to a
// single-character glyph.
//
// Logos are stored as 64×64 PNGs in /public/source-logos and rendered at
// 14-16px in the UI for crispness. Sourced from Google's public favicon
// service for standard attribution / source-citation use.

export interface SourceMeta {
  glyph: string
  label: string
  /** Visual tone: "data" reads solid (real fact), "estimate" reads amber
   *  (modeled), "default" reads dim (industry assumption you can override). */
  tone:  "data" | "estimate" | "default"
}

/** Map a normalized site key → public logo URL. Falls back to letter-glyph
 *  rendering for unknown sites (see SourceMark). */
const SITE_LOGOS: Record<string, string> = {
  zillow:  "/source-logos/zillow.png",
  redfin:  "/source-logos/redfin.png",
  realtor: "/source-logos/realtor.png",
  loopnet: "/source-logos/loopnet.png",
  crexi:   "/source-logos/crexi.png",
  mls:     "/source-logos/homes.png",   // homes.com is the public MLS-aggregator site we use
  homes:   "/source-logos/homes.png",
}

const SOURCE_LOGOS: Partial<Record<SourceKind, string>> = {
  hud_fmr: "/source-logos/hud.png",
  fred:    "/source-logos/fred.png",
}

/** Letter-glyph fallback for sites we don't have a logo for. Kept for
 *  the SourceMeta.label and the picker tooltip text. */
const SITE_GLYPHS: Record<string, string> = {
  zillow:  "Z",
  redfin:  "R",
  realtor: "RC",
  loopnet: "LN",
  crexi:   "CX",
  mls:     "MLS",
  homes:   "MLS",
}

export function siteGlyph(siteName: string | null | undefined): string {
  if (!siteName) return "•"
  const key = siteName.toLowerCase().replace(/[^a-z]/g, "")
  for (const k of Object.keys(SITE_GLYPHS)) if (key.includes(k)) return SITE_GLYPHS[k]
  return siteName.slice(0, 1).toUpperCase()
}

/** Resolve the logo URL for a source. Returns null if no brand logo exists
 *  (AI estimate, industry default, user-edited) → caller falls back to glyph. */
function logoFor(source: SourceKind | string, siteName?: string | null): string | null {
  if (source === "listing") {
    if (!siteName) return null
    const key = siteName.toLowerCase().replace(/[^a-z]/g, "")
    for (const k of Object.keys(SITE_LOGOS)) if (key.includes(k)) return SITE_LOGOS[k]
    return null
  }
  return SOURCE_LOGOS[source as SourceKind] ?? null
}

export function sourceMeta(source: SourceKind | string, siteName?: string | null): SourceMeta {
  switch (source) {
    case "listing":
      return { glyph: siteGlyph(siteName), label: siteName ? `Pulled directly from the ${siteName} listing` : "Pulled from the listing page", tone: "data" }
    case "hud_fmr":
      return { glyph: "HUD", label: "HUD Fair Market Rent for this zip code", tone: "data" }
    case "fred":
      return { glyph: "FRED", label: "30-year fixed rate from the Federal Reserve (FRED) API", tone: "data" }
    case "ai_estimate":
      return { glyph: "AI", label: "Estimated by AI from the page text — no published source on this listing", tone: "estimate" }
    case "default":
      return { glyph: "—", label: "Industry default — the listing didn't publish this, so I'm using a standard assumption you can override in Settings", tone: "default" }
    case "user":
      return { glyph: "✎", label: "Edited by you", tone: "data" }
    default:
      return { glyph: "?", label: String(source), tone: "default" }
  }
}

/** Human-readable freshness — "fetched just now", "4m ago", "2h ago", "11d ago". */
export function freshnessLabel(iso: string | undefined | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const ms  = Date.now() - t
  const min = Math.floor(ms / 60_000)
  if (min < 1)   return "fetched just now"
  if (min < 60)  return `fetched ${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `fetched ${hr}h ago`
  const d = Math.floor(hr / 24)
  return `fetched ${d}d ago`
}

/** Tiny brand chip — the visual unit of trust. Renders the actual brand
 *  logo as an image when one exists (Zillow, Redfin, FRED, HUD, etc.) and
 *  falls back to a letter glyph for sources without brand identity (AI
 *  estimate, industry default, user-edited). Same Mercury-style transaction-
 *  row pattern: real avatars where they're real, neutral chips elsewhere. */
export function SourceMark({
  source, siteName, size = "sm", title,
}: {
  source:    SourceKind | string
  siteName?: string | null
  size?:     "sm" | "md"
  /** Override the tooltip label (e.g. include a fetched-at timestamp). */
  title?:    string
}) {
  const meta  = sourceMeta(source, siteName)
  const logo  = logoFor(source, siteName)
  // The source mark IS the brand statement — confident chip size, not a
  // utility badge. Bumped again from 18→22 (sm) and 22→26 (md) after
  // user feedback that they read as small. md is used in headers + the
  // Sources drawer; sm is everywhere else.
  const dim   = size === "md" ? 26 : 22

  // Logo path — borderless circular crop. The logo IS the chip. Most
  // brand favicons are square with a colored background so they fill the
  // circle naturally. Subtle drop shadow gives the chip presence against
  // the dark canvas without a wedding-band-like border. Logos with
  // transparency get a theme-adaptive substrate so they don't disappear
  // on light backgrounds.
  if (logo) {
    return (
      <span
        title={title ?? meta.label}
        className="inline-flex items-center justify-center shrink-0 rounded-full overflow-hidden"
        style={{
          width:      dim,
          height:     dim,
          // Theme-adaptive substrate — only visible behind logos with
          // transparency (most have their own background). Avoids the
          // jarring white-on-dark "circle of paper" look.
          background: "var(--rv-elev-3)",
          // Soft outer shadow for chip definition. No border — the
          // shadow does the edge work without the cheap white ring.
          boxShadow:  "0 1px 3px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.15)",
        }}
      >
        <img
          src={logo}
          alt={meta.label}
          width={dim}
          height={dim}
          style={{
            display:    "block",
            // cover: fills the circle entirely. Square logos crop their
            // corners against the circle (good — that's the chip).
            objectFit:  "cover",
            width:      "100%",
            height:     "100%",
          }}
          draggable={false}
        />
      </span>
    )
  }

  // Letter-glyph fallback. Data sources read solid; estimates/defaults read
  // dimmer so the user can at-a-glance separate "real fact" from "assumption."
  const fg =
    meta.tone === "data"     ? "var(--rv-t2)" :
    meta.tone === "estimate" ? "var(--rv-warn)" :
                               "var(--rv-t4)"
  const bg =
    meta.tone === "data"     ? "var(--rv-elev-2)" :
    meta.tone === "estimate" ? "rgba(245,158,11,0.10)" :
                               "var(--rv-elev-1)"
  const border =
    meta.tone === "data"     ? "var(--rv-border-mid)" :
    meta.tone === "estimate" ? "rgba(245,158,11,0.22)" :
                               "var(--rv-border)"
  const padX = size === "md" ? 6 : 4
  const padY = size === "md" ? 2 : 1
  const fontSize = size === "md" ? 10 : 9

  // Letter glyph — circular when single-character (matches logo chips so
  // the visual rhythm is consistent), pill-shaped when multi-character
  // ("HUD", "FRED", "AI"). Same shadow-defines-edge language as the
  // logo chips — no border, just background + subtle outer shadow.
  const isSingleChar = meta.glyph.length === 1
  return (
    <span
      title={title ?? meta.label}
      className={`inline-flex items-center justify-center font-semibold tracking-wider tabular-nums shrink-0 ${isSingleChar ? "rounded-full" : "rounded-[6px]"}`}
      style={{
        color:        fg,
        background:   bg,
        boxShadow:    `0 1px 2px rgba(0, 0, 0, 0.30), 0 0 0 0.5px ${border}`,
        padding:      isSingleChar ? 0 : `${padY}px ${padX}px`,
        fontSize:     `${fontSize}px`,
        lineHeight:   1,
        minWidth:     dim,
        width:        isSingleChar ? dim : undefined,
        height:       dim,
        letterSpacing: meta.glyph.length > 1 ? "0.04em" : "0",
      }}
    >
      {meta.glyph}
    </span>
  )
}

/** A row of unique source marks, deduped — used as a footer on metric cards. */
export function SourceStrip({
  sources, siteName,
}: {
  sources:   (SourceKind | string)[]
  siteName?: string | null
}) {
  const seen = new Set<string>()
  const unique = sources.filter((s) => {
    const key = s === "listing" ? `listing:${siteName ?? ""}` : s
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <span className="inline-flex items-center gap-1">
      {unique.map((s, i) => <SourceMark key={i} source={s} siteName={siteName} />)}
    </span>
  )
}
