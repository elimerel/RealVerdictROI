// ──────────────────────────────────────────────────────────────────────────
// RealVerdict shell — minimal, robust sidebar logic.
// State lives in main process; we just listen and apply.
// ──────────────────────────────────────────────────────────────────────────

(() => {
  const $ = (id) => document.getElementById(id)

  const app            = $("app")
  const sidebar        = $("sidebar")
  const resizeHandle   = $("resizeHandle")
  const pane           = $("contentPane")

  if (!app || !sidebar || !resizeHandle || !pane) {
    console.error("[shell] missing critical DOM nodes — aborting")
    return
  }

  const STORAGE_W = "rv-sidebar-width-v3"
  const SIDEBAR_DEFAULT_W = 200
  const SIDEBAR_MIN_W     = 140   // full mode minimum (icons + readable label)
  const SIDEBAR_MAX_W     = 260
  const SIDEBAR_ICONS_W   = 60    // icons-only mode width
  const SNAP_HIDE         = 35    // drag below this on release → hidden
  const SNAP_ICONS        = 110   // drag below this (above SNAP_HIDE) → icons-only

  let openMirror    = true
  let expandedWidth = SIDEBAR_DEFAULT_W

  // Width to restore the sidebar to whenever the toggle button re-opens
  // it. Frozen at app launch from localStorage so a session's drag-resize
  // doesn't change what "toggle on" goes back to — only the next launch
  // picks up the new persisted width.
  let toggleWidth = SIDEBAR_DEFAULT_W

  function setIconsOnlyClass(iconsOnly) {
    if (iconsOnly) app.classList.add("icons-only")
    else           app.classList.remove("icons-only")
  }

  // ── Apply state to DOM ──────────────────────────────────────────────────
  // Set inline width explicitly to the target so the CSS transition always
  // fires from the current (possibly drag-updated) width to the target.
  function applyState(open) {
    if (open) {
      document.documentElement.style.setProperty("--sidebar-w", `${expandedWidth}px`)
      setIconsOnlyClass(expandedWidth < SNAP_ICONS)
      app.classList.remove("sidebar-hidden")
      sidebar.style.width = `${expandedWidth}px`
      window.shellAPI?.setSidebarWidth?.(expandedWidth)
    } else {
      app.classList.add("sidebar-hidden")
      sidebar.style.width = "0px"
    }
  }

  function setFullExpandedWidth(w, { persist = true } = {}) {
    expandedWidth = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w))
    document.documentElement.style.setProperty("--sidebar-w", `${expandedWidth}px`)
    setIconsOnlyClass(false)
    sidebar.style.width = `${expandedWidth}px`
    if (persist) localStorage.setItem(STORAGE_W, String(expandedWidth))
    window.shellAPI?.setSidebarWidth?.(expandedWidth)
  }

  function setIconsExpandedWidth({ persist = true } = {}) {
    expandedWidth = SIDEBAR_ICONS_W
    document.documentElement.style.setProperty("--sidebar-w", `${SIDEBAR_ICONS_W}px`)
    setIconsOnlyClass(true)
    sidebar.style.width = `${SIDEBAR_ICONS_W}px`
    if (persist) localStorage.setItem(STORAGE_W, String(SIDEBAR_ICONS_W))
    window.shellAPI?.setSidebarWidth?.(SIDEBAR_ICONS_W)
  }

  // Restore persisted width — sets both the current expanded width AND
  // the toggle-restore width from localStorage at launch. Width can be
  // either icons (60) or full (140-260); we infer the mode from value.
  ;(() => {
    const savedW = parseInt(localStorage.getItem(STORAGE_W) || "", 10)
    if (Number.isFinite(savedW)) {
      const isIcons = savedW < SNAP_ICONS
      const clamped = isIcons
        ? SIDEBAR_ICONS_W
        : Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, savedW))
      expandedWidth = clamped
      toggleWidth   = clamped
      document.documentElement.style.setProperty("--sidebar-w", `${clamped}px`)
      setIconsOnlyClass(isIcons)
    }
  })()

  // ── Subscribe to sidebar state from main ────────────────────────────────
  // Only reset expandedWidth to toggleWidth on a CLOSED → OPEN transition
  // (i.e. user clicked the toggle button). Drag-release also broadcasts
  // sidebar:state(true) but openMirror was already true — preserve the
  // dragged width in that case.
  if (window.shellAPI?.onSidebarState) {
    window.shellAPI.onSidebarState((open) => {
      console.log("[shell] received sidebar:state =", open)
      const wasOpen = openMirror
      openMirror = open
      if (open && !wasOpen) {
        expandedWidth = toggleWidth
      }
      applyState(open)
    })
  } else {
    console.error("[shell] shellAPI.onSidebarState unavailable")
  }

  // Pull initial state from main
  if (window.shellAPI?.getSidebarState) {
    window.shellAPI.getSidebarState().then((open) => {
      console.log("[shell] initial sidebar state =", open)
      if (typeof open === "boolean") {
        openMirror = open
        applyState(open)
      } else {
        applyState(true)
      }
    }).catch((err) => {
      console.error("[shell] getSidebarState error:", err)
      applyState(true)
    })
  }

  // ── Drag-to-resize ──────────────────────────────────────────────────────
  let dragStartX     = 0
  let dragStartWidth = 0
  let dragging       = false

  resizeHandle.addEventListener("mousedown", (e) => {
    if (!openMirror) return
    e.preventDefault()
    dragging = true
    dragStartX = e.clientX
    dragStartWidth = expandedWidth
    app.classList.add("resizing")
    document.body.style.cursor = "col-resize"
  })

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return
    const dx = e.clientX - dragStartX
    const target = dragStartWidth + dx

    // Sidebar tracks the cursor cleanly — clamped only to [0, MAX].
    // On release the mouseup handler will snap to the nearest of three
    // targets (hidden / icons-only / full).
    const w = Math.max(0, Math.min(SIDEBAR_MAX_W, target))
    sidebar.style.width = `${w}px`
    document.documentElement.style.setProperty("--sidebar-w", `${Math.max(SIDEBAR_ICONS_W, w)}px`)
    // Live class toggle so labels collapse/reappear at the threshold —
    // gives the user a visual preview of where the snap will land.
    setIconsOnlyClass(w >= SNAP_HIDE && w < SNAP_ICONS)
    // Tell main the live width so nextView/browserView reflow per tick.
    window.shellAPI?.setSidebarWidth?.(w)
  })

  window.addEventListener("mouseup", (e) => {
    if (!dragging) return
    dragging = false
    app.classList.remove("resizing")
    document.body.style.cursor = ""

    const dx = e.clientX - dragStartX
    const target = dragStartWidth + dx

    // 3-state snap on release: hidden / icons-only / full
    if (target < SNAP_HIDE) {
      window.shellAPI?.setSidebar?.(false)
    } else if (target < SNAP_ICONS) {
      setIconsExpandedWidth()
      window.shellAPI?.setSidebar?.(true)
    } else {
      setFullExpandedWidth(target)
      window.shellAPI?.setSidebar?.(true)
    }
  })

  // ── Navigation ──────────────────────────────────────────────────────────
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = btn.getAttribute("data-route")
      if (!route) return
      setActive(route)
      window.shellAPI?.navigate?.(route)
    })
  })

  function setActive(route) {
    document.querySelectorAll(".nav-item").forEach((el) => {
      if (el.getAttribute("data-route") === route) el.setAttribute("data-active", "")
      else                                          el.removeAttribute("data-active")
    })
  }

  if (window.shellAPI?.onActiveRoute) {
    window.shellAPI.onActiveRoute((route) => setActive(route))
  }

  // ── First-paint signal — triggers nextView creation in main ────────────
  // Main computes layout on its own from cached sidebarWidth + sidebarOpen,
  // so we don't push bounds anymore. We just need to nudge it once so it
  // creates nextView. The bounds value is ignored on the main side, but
  // we keep the legacy IPC contract intact.
  function notifyShellReady() {
    if (!pane || !window.shellAPI) return
    const r = pane.getBoundingClientRect()
    window.shellAPI.setContentBounds({
      x:      Math.round(r.left),
      y:      Math.round(r.top),
      width:  Math.max(100, Math.round(r.width)),
      height: Math.max(100, Math.round(r.height)),
    })
    window.shellAPI.setSidebarWidth?.(expandedWidth)
  }

  requestAnimationFrame(notifyShellReady)
  ;[100, 300, 600].forEach((ms) => setTimeout(notifyShellReady, ms))

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    if (e.key === "\\") {
      e.preventDefault()
      window.shellAPI?.toggleSidebar?.()
      return
    }
    if (e.key === "1") { e.preventDefault(); setActive("/browse");   window.shellAPI?.navigate?.("/browse")   }
    if (e.key === "2") { e.preventDefault(); setActive("/pipeline"); window.shellAPI?.navigate?.("/pipeline") }
    if (e.key === "3") { e.preventDefault(); setActive("/settings"); window.shellAPI?.navigate?.("/settings") }
  })

  console.log("[shell] initialized")
})()
