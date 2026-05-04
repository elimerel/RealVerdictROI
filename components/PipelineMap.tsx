"use client"

// PipelineMap — interactive Mapbox view of every saved deal in the
// pipeline, plotted geographically. The map is the canvas: pins are the
// deals, color-coded by stage. Click a pin to select that deal (the host
// page's existing detail rail will pick it up). On load, fits bounds to
// every pin so the user sees their entire portfolio at a glance.
//
// Design intent: real estate is geographic. Every other tool in the
// category renders pipelines as tables. The map view is RealVerdict's
// single biggest visual differentiator — open the page and you see your
// portfolio as places, not rows.
//
// Deals get geocoded lazily via lib/mapbox.ts (same cache as the static
// PropertyMap thumbnails). On first load with a fresh user, geocoding
// happens in parallel; pins fade in as each one resolves. Subsequent
// loads are instant from cache.

import { useEffect, useMemo, useRef, useState } from "react"
import mapboxgl, { type Map as MapboxMap, type Marker } from "mapbox-gl"
// Mapbox CSS is imported globally in app/globals.css (Turbopack
// sometimes loads in-component CSS imports too late, causing the
// canvas to render at 0×0 on first paint).
import { geocode, type Coords } from "@/lib/mapbox"
import { STAGE_COLOR, type SavedDeal } from "@/lib/pipeline"

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""

interface Props {
  deals:        SavedDeal[]
  selectedId:   string | null
  onSelect:     (id: string) => void
  /** Theme picks the Mapbox style. The host calls styleForTheme() and
   *  passes the result so this stays in sync with the app theme without
   *  re-reading classList here. */
  styleId:      "dark" | "light"
}

interface DealWithCoords extends SavedDeal {
  coords: Coords
}

export default function PipelineMap({
  deals, selectedId, onSelect, styleId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<MapboxMap | null>(null)
  const markersRef   = useRef<Map<string, Marker>>(new Map())
  const [resolved, setResolved] = useState<Record<string, Coords>>({})

  // ── Geocode all deals in parallel ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    deals.forEach((d) => {
      if (resolved[d.id]) return
      void geocode({ address: d.address, city: d.city, state: d.state, zip: d.zip })
        .then((c) => {
          if (cancelled || !c) return
          setResolved((prev) => prev[d.id] ? prev : { ...prev, [d.id]: c })
        })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals.map((d) => d.id).join(",")])

  // Resolved deals — only those we've geocoded successfully.
  const placedDeals = useMemo<DealWithCoords[]>(
    () => deals
      .map((d) => resolved[d.id] ? { ...d, coords: resolved[d.id] } : null)
      .filter((d): d is DealWithCoords => d !== null),
    [deals, resolved]
  )

  // ── Init map (once) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !TOKEN) return
    mapboxgl.accessToken = TOKEN

    const m = new mapboxgl.Map({
      container: containerRef.current,
      style:     styleId === "light"
        ? "mapbox://styles/mapbox/light-v11"
        : "mapbox://styles/mapbox/dark-v11",
      center:    [-98.5795, 39.8283],  // geographic US center as a calm default
      zoom:      3.5,
      attributionControl: false,
      logoPosition: "bottom-right",
    })

    // Add a tiny zoom control bottom-right. Premium-app convention.
    m.addControl(new mapboxgl.NavigationControl({
      showCompass: false,
      visualizePitch: false,
    }), "bottom-right")

    mapRef.current = m

    // Force a resize after the next paint — covers the case where
    // Mapbox initialized before the container's flex dimensions were
    // computed (which would leave a 0×0 canvas even though the wrapper
    // is sized correctly). This is the standard "blank map" fix.
    m.on("load", () => {
      requestAnimationFrame(() => {
        try { m.resize() } catch { /* ignore */ }
      })
    })

    // ResizeObserver — when the detail rail slides in/out, the map's
    // container changes width. Mapbox doesn't re-render automatically
    // when its container resizes; we call resize() manually so the map
    // re-fits and the markers stay anchored to their lng/lat. Without
    // this, opening a deal would visually offset every pin.
    //
    // Guard rails: between the time the user navigates away and the
    // cleanup runs, ResizeObserver can still fire on a torn-down map
    // and Mapbox throws "Cannot set properties of undefined" trying
    // to resize a removed canvas. Track removal in a flag and
    // double-check the map's container is still in the DOM.
    let removed = false
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (removed) return
        try {
          const container = m.getContainer()
          if (!container || !container.isConnected) return
          m.resize()
        } catch { /* map already torn down — silent */ }
      })
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      removed = true
      ro.disconnect()
      m.remove()
      mapRef.current = null
      markersRef.current.clear()
    }
  }, [styleId])

  // ── Sync style when theme changes ──────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    m.setStyle(styleId === "light"
      ? "mapbox://styles/mapbox/light-v11"
      : "mapbox://styles/mapbox/dark-v11")
  }, [styleId])

  // ── Render markers + fit bounds when placed deals change ───────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m) return

    // Remove markers that no longer have a deal.
    const existingIds = new Set(placedDeals.map((d) => d.id))
    markersRef.current.forEach((marker, id) => {
      if (!existingIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    })

    // Add or update markers.
    placedDeals.forEach((deal) => {
      const existing = markersRef.current.get(deal.id)
      const isSelected = deal.id === selectedId
      const color = STAGE_COLOR[deal.stage]

      if (existing) {
        // Update color / selected state. getElement() returns HTMLElement;
        // we cast since we know we always create div elements ourselves.
        const el = existing.getElement() as HTMLDivElement
        styleMarkerEl(el, color, isSelected)
        return
      }

      const el = document.createElement("div")
      styleMarkerEl(el, color, isSelected)
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onSelect(deal.id)
      })

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([deal.coords.lng, deal.coords.lat])
        .addTo(m)

      markersRef.current.set(deal.id, marker)
    })

    // Fit map to all markers (only the first time we have placements).
    if (placedDeals.length > 0) {
      const bounds = new mapboxgl.LngLatBounds()
      placedDeals.forEach((d) => bounds.extend([d.coords.lng, d.coords.lat]))
      // Don't auto-fit if already user-positioned (zoom > 5 + has previous bounds).
      // For now: always fit on count change — fine for MVP.
      m.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 13,
        duration: placedDeals.length === markersRef.current.size ? 0 : 800,
      })
    }
  }, [placedDeals, selectedId, onSelect])

  // Token missing — most likely cause: NEXT_PUBLIC_MAPBOX_TOKEN added to
  // .env.local after the dev server started. Next.js only reads .env on
  // server boot, not on HMR. Show the user something useful instead of
  // a blank canvas.
  if (!TOKEN) {
    return (
      <div
        className="relative w-full h-full flex items-center justify-center px-8"
        style={{ background: "var(--rv-elev-1)" }}
      >
        <div className="text-center max-w-[360px]">
          <p className="text-[14px] font-medium" style={{ color: "var(--rv-t1)" }}>
            Map can&rsquo;t load
          </p>
          <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--rv-t3)" }}>
            Mapbox token isn&rsquo;t available to the renderer.
            Restart the dev server (Next.js loads <code style={{ color: "var(--rv-t2)" }}>.env.local</code>{" "}
            on boot, not HMR).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative w-full h-full"
      style={{
        background: "var(--rv-elev-1)",
        minHeight:  300,  // safety net so flex doesn't collapse the map
        minWidth:   300,
      }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        // Mapbox needs the container to have explicit dimensions before
        // init. Setting them inline here avoids any flex/CSS race where
        // the canvas measures 0×0 on first paint.
        style={{ width: "100%", height: "100%" }}
      />

      {/* Empty state — when there are deals but none have geocoded yet */}
      {deals.length > 0 && placedDeals.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-[12px]" style={{ color: "var(--rv-t3)" }}>
            Locating {deals.length} {deals.length === 1 ? "deal" : "deals"}…
          </p>
        </div>
      )}

      {/* No-deals state */}
      {deals.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-[300px] px-6">
            <p className="text-[14px] font-medium" style={{ color: "var(--rv-t1)" }}>
              No deals on the map yet
            </p>
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--rv-t3)" }}>
              Save a listing from Browse, and it&rsquo;ll appear here as a pin
              colored by its stage.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Style a marker DOM element. The marker is a small filled circle with
 *  a soft ring when selected. Pure CSS on a div — no SVG, no extra DOM
 *  weight per pin. Mapbox's wrapper handles the lng/lat centering, so
 *  the element itself just renders at its natural size. */
function styleMarkerEl(el: HTMLDivElement, color: string, selected: boolean) {
  const size = selected ? 18 : 14
  const ringPx = selected ? 8 : 0
  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    background: ${color};
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.92);
    box-shadow: 0 2px 6px rgba(0,0,0,0.45), 0 0 0 ${ringPx}px ${color}33;
    cursor: pointer;
    transition: width 180ms cubic-bezier(0.32,0.72,0,1), height 180ms cubic-bezier(0.32,0.72,0,1), box-shadow 220ms cubic-bezier(0.32,0.72,0,1);
  `
}
