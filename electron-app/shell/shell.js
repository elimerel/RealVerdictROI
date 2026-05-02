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
  const SIDEBAR_MIN_W     = 100   // allow dragging much narrower before snapping
  const SIDEBAR_MAX_W     = 260
  const SNAP_TO_HIDE      = 70    // only snap to hidden when dragged tiny

  let openMirror    = true
  let expandedWidth = SIDEBAR_DEFAULT_W

  // ── Apply state to DOM ──────────────────────────────────────────────────
  // Set inline width explicitly to the target so the CSS transition always
  // fires from the current (possibly drag-updated) width to the target.
  function applyState(open) {
    document.documentElement.style.setProperty("--sidebar-w", `${expandedWidth}px`)
    if (open) {
      app.classList.remove("sidebar-hidden")
      sidebar.style.width = `${expandedWidth}px`
    } else {
      app.classList.add("sidebar-hidden")
      sidebar.style.width = "0px"
    }
    animateBounds(220)  // matches the new transition duration
  }

  function animateBounds(_duration) {
    // No-op now: main owns layout and recomputes synchronously on every
    // window-resize tick, sidebar toggle, and sidebar-drag mousemove.
    // The CSS transition on .sidebar visually animates width on its own.
  }

  function setExpandedWidth(w, { persist = true } = {}) {
    expandedWidth = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w))
    document.documentElement.style.setProperty("--sidebar-w", `${expandedWidth}px`)
    if (persist) localStorage.setItem(STORAGE_W, String(expandedWidth))
    window.shellAPI?.setSidebarWidth?.(expandedWidth)
  }

  // Restore persisted width
  ;(() => {
    const savedW = parseInt(localStorage.getItem(STORAGE_W) || "", 10)
    if (Number.isFinite(savedW)) setExpandedWidth(savedW, { persist: false })
  })()

  // ── Subscribe to sidebar state from main ────────────────────────────────
  if (window.shellAPI?.onSidebarState) {
    window.shellAPI.onSidebarState((open) => {
      console.log("[shell] received sidebar:state =", open)
      openMirror = open
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

    // Always track the cursor — don't preview-snap to 0 below the threshold.
    // This lets the release animate from the actual dragged width down to 0
    // (or up to the clamped expanded width) using the CSS transition.
    const w = Math.max(0, Math.min(SIDEBAR_MAX_W, target))
    sidebar.style.width = `${w}px`
    document.documentElement.style.setProperty("--sidebar-w", `${Math.max(SIDEBAR_MIN_W, w)}px`)
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

    if (target < SNAP_TO_HIDE) {
      window.shellAPI?.setSidebar?.(false)
    } else {
      const w = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, target))
      setExpandedWidth(w)
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
