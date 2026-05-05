"use client"

// PropertyMap — Mapbox static-image preview of a property's location.
//
// Three sizes (thumbnail / inline / banner) cover the contexts where we
// want to ground a deal in physical space:
//   - thumb:  64×48 — Pipeline list rows, dashboard previews
//   - inline: 320×140 — Browse panel property identity, sidebars
//   - banner: 100% × 180 — DealDetail header, hero placement
//
// Geocoding is lazy and cached (lib/mapbox.ts handles the localStorage
// layer). On first render, shows a calm skeleton; once coords resolve,
// fades the static map in. If geocode fails (no token, bad address, no
// network), the component renders nothing — never breaks a layout.

import { useEffect, useState } from "react"
import { geocode, staticMapUrl, styleForTheme, type Coords } from "@/lib/mapbox"

type Size = "thumb" | "inline" | "banner"
type View = "map" | "satellite"

const SIZES: Record<Size, { w: number | "100%"; h: number; zoom: number; marker: boolean; requestW: number }> = {
  thumb:  { w: 64,    h: 48,  zoom: 13, marker: false, requestW: 128  },
  inline: { w: "100%", h: 160, zoom: 14, marker: true,  requestW: 640  },
  banner: { w: "100%", h: 200, zoom: 14, marker: true,  requestW: 1200 },
}

interface Props {
  /** Address parts — at minimum we need address+city or address+zip to
   *  geocode reliably. */
  address?: string | null
  city?:    string | null
  state?:   string | null
  zip?:     string | null
  size:     Size
  /** Optional — round the corners more or less aggressively to match the
   *  parent surface. Defaults to 8px. */
  radius?:  number
  /** Optional className passthrough for layout (margin, etc.). */
  className?: string
  /** "map" (default) renders the standard street-tile look. "satellite"
   *  swaps to Mapbox satellite imagery zoomed in to property level —
   *  used in the analysis panel so the in-panel "where" view is
   *  visually distinct from the overview map at the app-shell level
   *  (no longer feels like a duplicate). */
  view?:    View
  /** Optional click handler — when set on a satellite view, the tile
   *  becomes interactive and surfaces an "Expand" hover chip. Caller
   *  hosts whatever modal/overlay opens; this keeps PropertyMap pure
   *  (no Google or modal dependencies). */
  onExpand?: () => void
}

export default function PropertyMap({
  address, city, state, zip, size, radius = 8, className, view = "map", onExpand,
}: Props) {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [failed, setFailed] = useState(false)
  const cfg = SIZES[size]

  useEffect(() => {
    let cancelled = false
    setCoords(null)
    setFailed(false)
    geocode({ address, city, state, zip }).then((c) => {
      if (cancelled) return
      if (c) setCoords(c)
      else   setFailed(true)
    })
    return () => { cancelled = true }
  }, [address, city, state, zip])

  // Hide entirely on geocode failure — better than a broken / empty map.
  if (failed) return null

  if (!coords) {
    // Calm skeleton — same dimensions as the eventual map so the layout
    // doesn't shift when the image loads.
    return (
      <div
        className={className}
        style={{
          width:        cfg.w,
          height:       cfg.h,
          borderRadius: radius,
          background:   "var(--rv-elev-2)",
          border:       "0.5px solid var(--rv-border)",
        }}
      />
    )
  }

  // Satellite view = aerial photo-style close-up of the property (zoom
  // 18 puts you about a block above the rooftop, like Google Earth).
  // Map view = street-level tiles matching the app theme.
  const isSat = view === "satellite"
  const url = staticMapUrl({
    lat:    coords.lat,
    lng:    coords.lng,
    width:  cfg.requestW,
    height: cfg.h,
    zoom:   isSat ? 18 : cfg.zoom,
    style:  isSat ? "satellite-streets-v12" : styleForTheme(),
    marker: cfg.marker,
  })

  // Satellite view doubles as a tap-target: click → darken with a
  // "View street view ↗" CTA that opens the property in Google Maps
  // (street view URL). Free for us — Google bills the user, and the
  // user gets the highest-fidelity ground-level view of the address
  // without us paying Street View Static API rates ($7/1k) at scale.
  // Non-satellite views stay non-interactive.
  const interactive = isSat
  return (
    <div
      className={`${className ?? ""} group relative`}
      style={{
        width:        cfg.w,
        height:       cfg.h,
        borderRadius: radius,
        overflow:     "hidden",
        border:       "0.5px solid var(--rv-border)",
        boxShadow:    "inset 0 1px 0 rgba(255,255,255,0.04)",
        background:   "var(--rv-elev-2)",
        cursor:       interactive ? "pointer" : "default",
      }}
      onClick={interactive && onExpand ? () => onExpand() : undefined}
      title={interactive ? "Click to view street view on Google Maps" : undefined}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        style={{
          width:    "100%",
          height:   "100%",
          objectFit:"cover",
          display:  "block",
          animation: "rv-map-fade 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
        }}
      />
      {interactive && (
        <>
          {/* Hover scrim — darkens the imagery on mouseover to surface
              the CTA. Pure CSS via group-hover so it stays cheap. */}
          <div
            className="absolute inset-0 transition-opacity duration-200 pointer-events-none opacity-0 group-hover:opacity-100"
            style={{
              background: "linear-gradient(180deg, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.55) 100%)",
            }}
          />
          {/* CTA chip — quiet by default, lifts on hover. Sits at the
              bottom-right so it doesn't crowd the corner caption. */}
          <div
            className="absolute bottom-2.5 right-2.5 transition-opacity duration-200 pointer-events-none opacity-70 group-hover:opacity-100"
          >
            <div
              className="inline-flex items-center gap-1.5 rounded-full text-[10.5px] uppercase tracking-widest font-medium"
              style={{
                color:      "rgba(245, 245, 247, 0.96)",
                background: "rgba(15, 15, 18, 0.62)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                padding:    "4px 10px",
                border:     "0.5px solid rgba(255, 255, 255, 0.10)",
                boxShadow:  "0 2px 8px rgba(0, 0, 0, 0.30)",
              }}
            >
              View street view <span style={{ marginLeft: 1 }}>↗</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
