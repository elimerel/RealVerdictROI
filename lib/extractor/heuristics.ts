// ---------------------------------------------------------------------------
// Pre-flight heuristics
// ---------------------------------------------------------------------------
//
// Cheap, deterministic checks we run BEFORE sending anything to the AI.
// Two purposes:
//   1. Save API spend on obvious non-content (captcha, blocked, empty pages).
//   2. Avoid false-positive captcha detection that the previous build had —
//      the captcha check used to fire on legitimate Zillow pages because
//      Zillow's own footer / cookie banner contains the word "verify".
//
// Rule: be SPECIFIC about what counts as a captcha. We anchor on full
// phrases that effectively never appear outside of a verification screen.
// ---------------------------------------------------------------------------

const STRICT_CAPTCHA_PATTERNS: RegExp[] = [
  /press\s*&?\s*hold\s+to\s+confirm/i,
  /please\s+(confirm|verify)\s+you\s+are\s+(a\s+)?human/i,
  /verify\s+you('|’)?re\s+a\s+human/i,
  /are\s+you\s+a\s+robot\??/i,
  /unusual\s+traffic\s+from\s+your\s+computer\s+network/i,
  /this\s+page\s+is\s+protected\s+by\s+(captcha|recaptcha|hcaptcha|cloudflare)/i,
  /access\s+to\s+this\s+page\s+has\s+been\s+denied/i,
  /\bcaptcha\b/i,
  /please\s+complete\s+the\s+security\s+check/i,
  /checking\s+your\s+browser\s+before\s+accessing/i,
]

/** Returns true ONLY if the page is unambiguously a verification / blocked
 *  screen. The previous, looser version produced false positives on real
 *  Zillow listings — that's why we anchor on multi-word phrases here. */
export function looksLikeCaptcha(title: string, text: string): boolean {
  // We bias to the top of the page where the verification UI lives.
  // A real listing has thousands of words after the hero; a captcha page
  // usually has a few hundred at most.
  const head = `${title || ""}\n${(text || "").slice(0, 2_000)}`

  // A captcha page is mostly chrome — if the entire page text is short and
  // matches one of our patterns, we're confident. If the page is long, we
  // need a high-signal phrase, not just the word "captcha" in a footer
  // disclosure.
  const isShort = (text || "").length < 600

  for (const re of STRICT_CAPTCHA_PATTERNS) {
    if (!re.test(head)) continue
    // The bare /\bcaptcha\b/ pattern is too loose on long pages — only
    // accept it when the page is short (i.e. content was actually blocked).
    if (re.source === "\\bcaptcha\\b" && !isShort) continue
    return true
  }
  return false
}

/** Minimum text length we need before bothering the AI. */
export const MIN_PAGE_TEXT_LENGTH = 200

/** Hostname helper (returns "the listing" when URL is bad). */
export function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "the listing"
  }
}
