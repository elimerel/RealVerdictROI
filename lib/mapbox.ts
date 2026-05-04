// Mapbox helpers — static-map tile URLs + lazy address-to-coordinate
// geocoding with localStorage caching.
//
// We deliberately use the Static Images API (returns a PNG) instead of
// embedding mapbox-gl-js. A property location thumbnail doesn't need pan,
// zoom, or layers — it needs to be a single, fast, predictable picture
// that says "this is the place." Static images render in one network
// request, no JS bundle bloat, no map-library boot-up flash.
//
// Token: NEXT_PUBLIC_MAPBOX_TOKEN in .env.local. The token is publishable
// by design (the "Default public token" in the Mapbox dashboard); it's
// safe to ship in client bundles. URL-restrict it in the Mapbox console
// before going to production.

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""

/** Resolved {lat, lng} for a property. We cache geocodes in localStorage
 *  so opening the same Pipeline page twice doesn't hit the API again. */
export interface Coords {
  lat: number
  lng: number
}

const CACHE_KEY = "rv-geocode-cache-v1"
type Cache = Record<string, Coords | "FAIL">

function readCache(): Cache {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Cache) : {}
  } catch { return {} }
}

function writeCache(c: Cache) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch {}
}

/** Build a normalized cache key from address parts. Lower-cased + trimmed
 *  so "123 Main St, Austin, TX" and "  123 main st, austin, TX" hit the
 *  same cache row. */
function addressKey(parts: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  return [parts.address, parts.city, parts.state, parts.zip]
    .filter(Boolean)
    .map((s) => s!.trim().toLowerCase())
    .join(", ")
}

/** Geocode an address via Mapbox. Returns null on failure (network, no
 *  token, no result). Caches both successes and explicit failures so we
 *  don't retry a permanently-bad address every render. */
export async function geocode(parts: {
  address?: string | null
  city?:    string | null
  state?:   string | null
  zip?:     string | null
}): Promise<Coords | null> {
  if (!TOKEN) return null
  const key = addressKey(parts)
  if (!key) return null

  const cache = readCache()
  const hit = cache[key]
  if (hit === "FAIL") return null
  if (hit) return hit

  const query = encodeURIComponent(key)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?country=us&types=address&limit=1&access_token=${TOKEN}`
  try {
    const r = await fetch(url)
    if (!r.ok) { cache[key] = "FAIL"; writeCache(cache); return null }
    const j = await r.json() as { features?: Array<{ center?: [number, number] }> }
    const feat = j.features?.[0]
    if (!feat?.center) { cache[key] = "FAIL"; writeCache(cache); return null }
    const [lng, lat] = feat.center
    const coords = { lat, lng }
    cache[key] = coords
    writeCache(cache)
    return coords
  } catch {
    cache[key] = "FAIL"
    writeCache(cache)
    return null
  }
}

/** Build a Mapbox Static Images URL with a single accent-colored marker
 *  centered on the given coords. Width/height in CSS px (we request @2x
 *  so the rendered image is sharp on retina). Style picks the look —
 *  default is "dark-v11" which matches the warm-charcoal app canvas. */
export function staticMapUrl({
  lat, lng, width, height, zoom = 14, style = "dark-v11", marker = true,
}: {
  lat:     number
  lng:     number
  width:   number
  height:  number
  zoom?:   number
  /** One of Mapbox's standard styles. satellite-v9 + satellite-streets-v12
   *  give the aerial-photo look used for the in-panel property view. */
  style?:  "dark-v11" | "light-v11" | "streets-v12" | "outdoors-v12" | "navigation-night-v1" | "satellite-v9" | "satellite-streets-v12"
  /** Whether to show the accent-colored pin at the center. */
  marker?: boolean
}): string {
  if (!TOKEN) return ""

  // Mapbox accent green (#30a46c) — matches the app's brand. The 's' suffix
  // is the small marker size; 'm' is medium, 'l' is large.
  const pin = marker
    ? `pin-s+30a46c(${lng},${lat})/`
    : ""

  // Cap dimensions to Mapbox's static-image limits (1280x1280 logical, 2x
  // retina). Width/height we pass are CSS px; @2x doubles them server-side.
  const w = Math.min(Math.max(Math.round(width),  1), 1280)
  const h = Math.min(Math.max(Math.round(height), 1), 1280)

  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${pin}${lng},${lat},${zoom},0/${w}x${h}@2x?access_token=${TOKEN}&attribution=false&logo=false`
}

/** Pick the best Mapbox style to match the current app theme. Reads from
 *  the html element's classList — the THEME_SCRIPT in app/layout.tsx
 *  has already stamped the right class before first paint. */
export function styleForTheme(): "dark-v11" | "light-v11" {
  if (typeof document === "undefined") return "dark-v11"
  return document.documentElement.classList.contains("theme-light")
    ? "light-v11"
    : "dark-v11"
}
