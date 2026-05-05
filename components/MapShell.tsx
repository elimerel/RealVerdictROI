"use client"

// MapShell — the persistent Mapbox layer.
//
// Mounted ONCE at the app-shell level (inside AppLayout), behind the
// routed content. Reads its inputs from MapShellContext: deals,
// visibleDealIds, selectedId, cameraTarget. Writes pin-clicks back
// through the context so route pages can react.
//
// Why this exists: see lib/mapShell.tsx. The previous architecture
// had separate Mapbox instances on Browse and Pipeline, causing a
// visible re-mount when navigating. This component never unmounts —
// the camera glides between routes instead.
//
// The Mapbox plumbing is the same as the old PipelineMap (geocode,
// markers, fit-bounds, theme-style sync). Difference: every input
// comes from context, and pin clicks publish through context.

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import mapboxgl, { type Map as MapboxMap, type Marker } from "mapbox-gl"
import { Button } from "@/components/ui/button"
import { geocode, type Coords } from "@/lib/mapbox"
import { STAGE_COLOR, type SavedDeal } from "@/lib/pipeline"
import { useMapShell } from "@/lib/mapShell"
import { useMapStyle, resolveMapStyleUrl } from "@/lib/useMapStyle"

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""

interface DealWithCoords extends SavedDeal {
  coords: Coords
}

export default function MapShell() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<MapboxMap | null>(null)
  const markersRef   = useRef<Map<string, Marker>>(new Map())
  const [resolved, setResolved] = useState<Record<string, Coords>>({})

  const {
    deals, visibleDealIds, selectedId, cameraTarget,
    setSelectedId, _broadcastPinClick, setReady,
  } = useMapShell()

  // User's preferred Mapbox style — "auto" follows theme; specific
  // keys override. The hook re-fires on theme change AND when the
  // user picks a different style in Settings (via the rv:prefs-
  // changed broadcast event), so the map stays in sync without a
  // remount. styleId is the resolved Mapbox URL — when it changes,
  // the map-init effect tears down + rebuilds the map (markers
  // re-render automatically once the new instance loads).
  const mapStyleKey = useMapStyle()
  const [styleId, setStyleId] = useState<string>(() => resolveMapStyleUrl(mapStyleKey))
  useEffect(() => {
    setStyleId(resolveMapStyleUrl(mapStyleKey))
    // Also re-resolve on theme change when the pref is "auto",
    // since "auto" reads the html theme class.
    const observer = new MutationObserver(() => {
      setStyleId(resolveMapStyleUrl(mapStyleKey))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [mapStyleKey])

  // ── Geocode all deals lazily, in parallel ────────────────────────────
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

  // Filter to visible deals and project to coords. NULL visibleDealIds
  // means "show all" — used by Browse where every saved deal is a pin.
  const placedDeals = useMemo<DealWithCoords[]>(
    () => deals
      .filter((d) => visibleDealIds === null || visibleDealIds.has(d.id))
      .map((d) => resolved[d.id] ? { ...d, coords: resolved[d.id] } : null)
      .filter((d): d is DealWithCoords => d !== null),
    [deals, visibleDealIds, resolved]
  )

  // ── Init map (once per styleId) ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !TOKEN) return
    // Tear down + recreate when the style changes — Mapbox's setStyle
    // works in many cases but loses custom layers; for our marker-only
    // map a clean recreate is the simpler and more reliable path.
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      markersRef.current.clear()
    }
    mapboxgl.accessToken = TOKEN

    const m = new mapboxgl.Map({
      container: containerRef.current,
      style:     styleId,
      center:    [-98.5795, 39.8283],
      zoom:      3.5,
      attributionControl: false,
      logoPosition: "bottom-right",
    })
    m.addControl(new mapboxgl.NavigationControl({
      showCompass: false,
      visualizePitch: false,
    }), "bottom-right")

    mapRef.current = m

    m.on("load", () => {
      requestAnimationFrame(() => {
        try { m.resize() } catch { /* ignore */ }
      })
      setReady(true)
    })

    let removed = false
    // Debounced resize — ResizeObserver fires once per animation
    // frame during transitions (route navigation 140ms, panel slide
    // 220ms, window resize). Without coalescing, calling m.resize()
    // every frame triggers full Mapbox canvas re-renders and reads
    // as a stuttery flicker. 180ms trailing debounce is calibrated
    // to fire AFTER the longest chrome transition we run (140ms +
    // a small idle window), so the map redraws ONCE per layout
    // change instead of per-frame.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (removed) return
        try {
          const container = m.getContainer()
          if (!container || !container.isConnected) return
          m.resize()
        } catch { /* ignore */ }
      }, 180)
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      removed = true
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()
      m.remove()
      mapRef.current = null
      markersRef.current.clear()
      setReady(false)
    }
  }, [styleId, setReady])

  // ── Render markers when placed deals change ──────────────────────────
  useEffect(() => {
    const m = mapRef.current
    if (!m) return

    const existingIds = new Set(placedDeals.map((d) => d.id))
    markersRef.current.forEach((marker, id) => {
      if (!existingIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    })

    placedDeals.forEach((deal) => {
      const existing = markersRef.current.get(deal.id)
      const isSelected = deal.id === selectedId
      const color = STAGE_COLOR[deal.stage]

      if (existing) {
        const el = existing.getElement() as HTMLDivElement
        const wasSelected = el.dataset.selected === "true"
        styleMarkerEl(el, color, isSelected)
        // Pulse animation when a marker becomes selected (was not, now
        // is). Triggered by re-applying the keyframe via class-toggle.
        if (isSelected && !wasSelected) {
          el.classList.remove("rv-pin-pulse")
          // Force reflow so the next class-add restarts the animation.
          void el.offsetWidth
          el.classList.add("rv-pin-pulse")
        }
        return
      }

      const el = document.createElement("div")
      styleMarkerEl(el, color, isSelected)
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        setSelectedId(deal.id)
        _broadcastPinClick(deal.id)
      })

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([deal.coords.lng, deal.coords.lat])
        .addTo(m)

      markersRef.current.set(deal.id, marker)
    })
  }, [placedDeals, selectedId, setSelectedId, _broadcastPinClick])

  // Gentle pan-on-select — keeps the user's current zoom intact (so
  // the overview view they zoomed out to is preserved) but slides the
  // camera so the selected pin sits center-stage. Without this, going
  // through a list of deals felt static — only the marker color
  // changed. This restores the "alive" feeling without auto-zooming.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !selectedId) return
    const target = placedDeals.find((d) => d.id === selectedId)
    if (!target) return
    m.easeTo({
      center:   [target.coords.lng, target.coords.lat],
      duration: 380,
      easing:   (t) => 1 - Math.pow(1 - t, 3), // ease-out-cubic — quick start, gentle settle
    })
  }, [selectedId, placedDeals])

  // ── Deterministic resize on route change ────────────────────────────
  //
  // The ResizeObserver above debounces resizes by 180ms, which is
  // great for window-level resize events (no thrashing) but creates
  // a visible gap at the bottom of the map during route transitions:
  // the chrome (BrowseTabsRow) collapses 40px → 0 over 140ms, the
  // map's container grows by 40px, but the Mapbox canvas hasn't
  // resized yet → 40px of bg color shows at the bottom for ~320ms.
  //
  // This effect resizes EXACTLY at the moment the chrome transition
  // finishes (160ms after pathname change). The ResizeObserver still
  // catches everything else; this just makes route changes
  // deterministic instead of debounce-delayed.
  const pathname = usePathname()
  const lastPathnameRef = useRef(pathname)
  useEffect(() => {
    if (lastPathnameRef.current === pathname) return
    const prevPath = lastPathnameRef.current
    lastPathnameRef.current = pathname
    // Halt any in-flight camera animation when the user leaves the
    // map's home routes (Browse / Pipeline). Without this, an easeTo or
    // flyTo started on the last route keeps running rAF for its full
    // duration even though the user is now on Settings — wasted GPU
    // and a stutter risk on the route they just landed on.
    const leftMapRoute = !prevPath.startsWith("/browse") &&
                         !prevPath.startsWith("/pipeline") ? false :
                         (!pathname.startsWith("/browse") &&
                          !pathname.startsWith("/pipeline"))
    if (leftMapRoute) {
      try { mapRef.current?.stop() } catch { /* ignore */ }
    }
    // 180ms = chrome transition (160ms) + 20ms grace so the map
    // resize happens just AFTER the layout has fully settled.
    const t = setTimeout(() => {
      try { mapRef.current?.resize() } catch { /* ignore */ }
    }, 180)
    return () => clearTimeout(t)
  }, [pathname])

  // ── Camera — flyTo when target changes; fitBounds on first deals ────
  const lastTargetRef = useRef<typeof cameraTarget>(null)
  const didInitialFitRef = useRef(false)
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    if (cameraTarget && cameraTarget !== lastTargetRef.current) {
      lastTargetRef.current = cameraTarget
      m.flyTo({
        center:   [cameraTarget.lng, cameraTarget.lat],
        zoom:     cameraTarget.zoom ?? Math.max(m.getZoom(), 12),
        duration: cameraTarget.duration ?? 900,
        essential: true,
      })
      return
    }
    // Auto-fit to all placed deals the first time we have any. Keeps
    // the "open the page and your portfolio fits the canvas" feel.
    if (!didInitialFitRef.current && placedDeals.length > 0) {
      didInitialFitRef.current = true
      const bounds = new mapboxgl.LngLatBounds()
      placedDeals.forEach((d) => bounds.extend([d.coords.lng, d.coords.lat]))
      m.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        maxZoom: 13,
        duration: 0,
      })
    }
  }, [cameraTarget, placedDeals])

  // Fit-all recenter — kicks the camera back to a bounds-fit over every
  // visible pin. Surfaced as a small floating chip near the top-left
  // of the map; only renders when there are 2+ visible deals (a single
  // deal can't bound a meaningful view).
  const fitAll = () => {
    const m = mapRef.current
    if (!m || placedDeals.length === 0) return
    const bounds = new mapboxgl.LngLatBounds()
    placedDeals.forEach((d) => bounds.extend([d.coords.lng, d.coords.lat]))
    m.fitBounds(bounds, {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      maxZoom: 13,
      duration: 700,
    })
  }

  if (!TOKEN) {
    // Token missing — render nothing rather than the help text. The
    // shell sits behind UI; an error message would float behind the
    // route content where the user can't see it. The route can detect
    // missing token via a separate channel if it cares.
    return null
  }

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          width:  "100%",
          height: "100%",
          // Fallback bg matching typical Mapbox dark tile color. If
          // the canvas is briefly the wrong size during a route
          // transition (chrome shrinking faster than canvas can
          // resize), this is what shows behind it instead of an
          // obvious bright/wrong color. Light theme overrides via
          // an inline check on the html class — keeps the gap
          // invisible across themes.
          background: (() => {
            if (typeof document === "undefined") return "#1a1d23"
            const cls = document.documentElement.classList
            // Light themes (paper, legacy theme-light) → cream gap;
            // dark themes (paper-dark, anything else) → near-canvas grey.
            return (cls.contains("theme-paper") || cls.contains("theme-light"))
              ? "#eaeaec"
              : "#1a1d23"
          })(),
        }}
      />
      {placedDeals.length >= 2 && (
        <Button
          onClick={fitAll}
          title="Fit all your deals"
          variant="secondary"
          size="xs"
          className="absolute z-10 rounded-full text-[10.5px] uppercase tracking-widest"
          style={{
            top:        12,
            left:       12,
            color:      "rgba(245, 245, 247, 0.92)",
            background: "rgba(15, 15, 18, 0.62)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border:     "0.5px solid rgba(255, 255, 255, 0.10)",
            boxShadow:  "0 2px 8px rgba(0, 0, 0, 0.30)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--rv-accent)" }} />
          Fit all · {placedDeals.length}
        </Button>
      )}
    </>
  )
}

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
  // Stamp a data-attr so the renderer effect can detect a "becoming
  // selected" transition and trigger the pulse class.
  el.dataset.selected = selected ? "true" : "false"
  if (!selected) el.classList.remove("rv-pin-pulse")
}
