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

const SIZES: Record<Size, { w: number | "100%"; h: number; zoom: number; marker: boolean; requestW: number }> = {
  thumb:  { w: 64,    h: 48,  zoom: 13, marker: false, requestW: 128  },  // tiny — too small for a marker pin
  inline: { w: "100%", h: 140, zoom: 14, marker: true,  requestW: 640  },
  banner: { w: "100%", h: 180, zoom: 14, marker: true,  requestW: 1200 },
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
}

export default function PropertyMap({
  address, city, state, zip, size, radius = 8, className,
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

  // Mapbox bills per request, not per pixel, so we request a roomy fixed
  // width (per-size in SIZES.requestW) and let CSS scale it down. This
  // avoids re-fetching on every container resize.
  const url = staticMapUrl({
    lat:    coords.lat,
    lng:    coords.lng,
    width:  cfg.requestW,
    height: cfg.h,
    zoom:   cfg.zoom,
    style:  styleForTheme(),
    marker: cfg.marker,
  })

  return (
    <div
      className={className}
      style={{
        width:        cfg.w,
        height:       cfg.h,
        borderRadius: radius,
        overflow:     "hidden",
        border:       "0.5px solid var(--rv-border)",
        boxShadow:    "inset 0 1px 0 rgba(255,255,255,0.04)",
        background:   "var(--rv-elev-2)",
      }}
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
          // Subtle fade-in once the image actually arrives — feels intentional
          // instead of "image popped in." Matches the panel-enter motion.
          animation: "rv-map-fade 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
        }}
      />
    </div>
  )
}
