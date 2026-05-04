"use client"

// PropertyView — the EXPANDED modal that overlays the app when the
// user clicks the inline property satellite. Renders a Google Maps
// Embed iframe with [Aerial | Street] toggle, both free under the
// Embed API ToS.
//
// Why a modal and NOT inline: keeping Google's required "Maps" badge
// out of the everyday panel UI. The badge appears only here, where
// the user explicitly opted into the full Google view.
//
// Inline panel hero stays on Mapbox satellite static (PropertyMap),
// which is fast, has no third-party branding, and switches between
// deals instantly because it's a plain <img> not an iframe.

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { geocode, type Coords } from "@/lib/mapbox"

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""

type ViewMode = "aerial" | "street"

interface Props {
  address?: string | null
  city?:    string | null
  state?:   string | null
  zip?:     string | null
  /** Optional pre-resolved coords. If absent, the modal geocodes on
   *  open (cached via lib/mapbox so subsequent opens are instant). */
  lat?:     number | null
  lng?:     number | null
  /** Initial mode — "street" lands the user on the street view tab
   *  (the default expand intent: "what does this look like from the
   *  curb?"). Aerial is one toggle away. */
  initialMode?: ViewMode
  onClose: () => void
}

/** Configured? — used by callers to gate "expand" affordances. */
export function hasGoogleMapsKey(): boolean {
  return !!GOOGLE_KEY
}

export default function PropertyView({
  address, city, state, zip, lat, lng, initialMode = "street", onClose,
}: Props) {
  const [mode, setMode] = useState<ViewMode>(initialMode)
  const [coords, setCoords] = useState<Coords | null>(
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null
  )

  useEffect(() => {
    if (coords) return
    let cancelled = false
    void geocode({ address, city, state, zip }).then((c) => {
      if (cancelled || !c) return
      setCoords(c)
    })
    return () => { cancelled = true }
  }, [address, city, state, zip, coords])

  // Esc closes — matches SourcesDrawer pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!GOOGLE_KEY) {
    // Caller shouldn't be opening this without a key, but render a
    // dismissable "configure" hint just in case.
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: "rgba(0, 0, 0, 0.72)" }}
        onClick={onClose}
      >
        <div
          className="rounded-[12px] px-6 py-5 max-w-sm text-center"
          style={{ background: "var(--rv-bg)", border: "0.5px solid var(--rv-border-mid)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[13.5px]" style={{ color: "var(--rv-t1)" }}>
            Set <code style={{ color: "var(--rv-t2)" }}>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> in <code>.env.local</code> to enable street view.
          </p>
        </div>
      </div>
    )
  }

  const query = encodeURIComponent([address, city, state, zip].filter(Boolean).join(", "))
  const aerialSrc = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_KEY}&q=${query}&maptype=satellite&zoom=19`
  const streetSrc = coords
    ? `https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_KEY}&location=${coords.lat},${coords.lng}&heading=0&pitch=0&fov=90`
    : aerialSrc

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{
        background:           "rgba(0, 0, 0, 0.78)",
        backdropFilter:       "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col"
        style={{
          width:        "min(1100px, 90vw)",
          height:       "min(720px, 86vh)",
          background:   "var(--rv-bg)",
          border:       "0.5px solid var(--rv-border-mid)",
          borderRadius: 14,
          overflow:     "hidden",
          boxShadow:    "0 30px 80px rgba(0, 0, 0, 0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{ height: 48, borderBottom: "0.5px solid var(--rv-border)" }}
        >
          <div
            className="inline-flex rounded-full overflow-hidden"
            style={{ background: "var(--rv-elev-2)", border: "0.5px solid var(--rv-border)" }}
          >
            {(["aerial", "street"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="text-[11.5px] uppercase tracking-widest font-medium transition-colors"
                style={{
                  color:      mode === m ? "var(--rv-t1)" : "var(--rv-t3)",
                  background: mode === m ? "var(--rv-elev-4)" : "transparent",
                  padding:    "6px 14px",
                }}
              >
                {m === "aerial" ? "Aerial" : "Street view"}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-[8px] transition-colors"
            style={{ color: "var(--rv-t2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)"; e.currentTarget.style.color = "var(--rv-t1)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--rv-t2)" }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Both iframes always rendered, opacity-toggled — switching
            tabs is instant, no re-fetch. */}
        <div className="flex-1 min-h-0 relative">
          <iframe
            title="Property aerial view"
            src={aerialSrc}
            width="100%"
            height="100%"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              border:        0,
              display:       "block",
              position:      "absolute",
              inset:         0,
              opacity:       mode === "aerial" ? 1 : 0,
              transition:    "opacity 180ms cubic-bezier(0.32, 0.72, 0, 1)",
              pointerEvents: mode === "aerial" ? "auto" : "none",
            }}
            allowFullScreen
          />
          <iframe
            title="Property street view"
            src={streetSrc}
            width="100%"
            height="100%"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              border:        0,
              display:       "block",
              position:      "absolute",
              inset:         0,
              opacity:       mode === "street" ? 1 : 0,
              transition:    "opacity 180ms cubic-bezier(0.32, 0.72, 0, 1)",
              pointerEvents: mode === "street" ? "auto" : "none",
            }}
            allowFullScreen
          />
        </div>
      </div>
    </div>
  )
}
