"use client"

// ── BuddyMark ──────────────────────────────────────────────────────────────
//
// The single brand mark we use across the app — appears in the sidebar
// header, empty states, the AI-thinking state, and Settings → About. ONE
// shape, ONE accent color (sage). Mostly absent; its rare appearances
// become valuable because they're rare.
//
// Two states:
//   - rest:      static, sage fill
//   - thinking:  slow breath animation (scale 1 → 1.06 → 1, opacity 1 →
//                0.6 → 1). Used when the AI is reading a listing.
//
// Built from the same lightning-spark path the AppSidebar header uses,
// so the brand presence is consistent. No imported illustration needed —
// the mark is intentionally simple geometric vector.

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface BuddyMarkProps {
  /** Pixel size of the rendered mark. Defaults to 32 (medium). */
  size?:    number
  /** "rest" = static. "thinking" = slow breath animation (used when
   *  the AI is analyzing a listing or doing chat work). */
  state?:   "rest" | "thinking"
  /** Optional className for positioning / layout. */
  className?: string
  /** Tone — primary uses the sage accent (default); muted uses
   *  --rv-t3 for empty-state usage where the mark shouldn't punch. */
  tone?:    "primary" | "muted"
}

export function BuddyMark({ size = 32, state = "rest", className, tone = "primary" }: BuddyMarkProps) {
  const fill =
    tone === "muted"
      ? "var(--rv-t3)"
      : "var(--rv-accent)"

  // The lightning-spark path from the sidebar header, reused here so the
  // brand mark is consistent everywhere. viewBox is 14×14 to match.
  const Spark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill={fill} />
    </svg>
  )

  if (state === "thinking") {
    // Slow breath: scales between 1.0 and 1.06 with opacity dipping to
    // 0.6 mid-cycle. 2.4s loop — slow enough to read as breathing, not
    // pulsing. Same easing as everything else in the app (the macOS
    // cubic-bezier).
    return (
      <motion.div
        className={cn("inline-flex items-center justify-center", className)}
        animate={{
          scale:   [1, 1.06, 1],
          opacity: [1, 0.6, 1],
        }}
        transition={{
          duration: 2.4,
          repeat:   Infinity,
          ease:     [0.32, 0.72, 0, 1],
        }}
      >
        {Spark}
      </motion.div>
    )
  }

  return (
    <span className={cn("inline-flex items-center justify-center", className)}>
      {Spark}
    </span>
  )
}
