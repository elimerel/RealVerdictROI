"use client"

// ToastHost — renders the queue of buddy toasts at the bottom-right.
// Mounted once at the app layout; reads from the toast singleton.
//
// Visual: each toast is a rounded card with the buddy's voice — message
// in display serif (so it reads as voice, not chrome), tone-colored
// dot at the left, optional action button at the right. Stacks
// vertically when multiple are queued, with the newest at the bottom.

import { useToasts, dismissToast, type Toast } from "@/lib/toast"

export default function ToastHost() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div
      className="fixed flex flex-col gap-2 pointer-events-none"
      style={{
        right:    16,
        bottom:   16,
        zIndex:   100,
        maxWidth: 380,
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  // Tone color — the small dot at the left + optional outline tint.
  // Most toasts are neutral; pos / warn are reserved for moments that
  // genuinely warrant a color signal (saved, price drop).
  const dot =
    toast.tone === "pos"  ? "var(--rv-accent)" :
    toast.tone === "warn" ? "var(--rv-clay)"   :
                            "var(--rv-t3)"

  return (
    <div
      role="status"
      aria-live="polite"
      className="rv-toast-pop pointer-events-auto flex items-start gap-3 rounded-[10px] overflow-hidden"
      style={{
        padding:        "12px 14px",
        background:     "var(--rv-toast-bg)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        border:         "0.5px solid var(--rv-border-mid)",
        boxShadow:      "0 8px 24px rgba(0,0,0,0.40), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
      }}
    >
      {/* Tone dot — small, present, never loud. */}
      <span
        aria-hidden
        className="shrink-0 rounded-full"
        style={{
          width:      6,
          height:     6,
          marginTop:  7,
          background: dot,
          boxShadow:  `0 0 0 1.5px ${dot}25`,
        }}
      />
      {/* Message + optional detail. The message reads as the buddy's
          voice — display serif at 13.5px, comfortable to read in a
          glance. Detail line is sans-serif, smaller, muted. */}
      <div className="flex-1 min-w-0">
        <p
          className="leading-snug"
          style={{
            color:      "var(--rv-t1)",
            fontSize:   13.5,
            fontFamily: "var(--rv-font-display)",
            fontWeight: 400,
            letterSpacing: "-0.005em",
          }}
        >
          {toast.message}
        </p>
        {toast.detail && (
          <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: "var(--rv-t3)" }}>
            {toast.detail}
          </p>
        )}
      </div>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); dismissToast(toast.id) }}
          className="shrink-0 text-[12px] tracking-tight transition-colors self-center"
          style={{ color: "var(--rv-accent)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-accent)" }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 -mr-1 transition-colors self-center"
        style={{ color: "var(--rv-t4)", padding: 2 }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M2.5 2.5L8.5 8.5M8.5 2.5L2.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
