"use client"

// Toast — the buddy's voice in the moment.
//
// Not a generic notification system. The toast surface is where
// RealVerdict's AI presence shows up *as it happens*: when you save,
// it observes ("This one's above your portfolio average"). When you
// move stages, it nudges ("Want to compare with your Phoenix duplexes?").
// When a watch alert fires, it tells you ("1234 Main St dropped $15k
// overnight"). The toast is the buddy talking *to you*, briefly.
//
// Design constraints:
// - One at a time (queue if multiple). The buddy isn't chatty.
// - Bottom-right corner. Out of the way of the main work surface.
// - 3.5s default dwell — enough to read a sentence, not enough to nag.
// - Click to dismiss. Action button optional (e.g. "View in pipeline").
// - No icons unless the message warrants them — the toast is a voice,
//   not a status badge.

import { useSyncExternalStore } from "react"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id:        string
  /** The primary line — what the buddy would say. Short, sentence-cased. */
  message:   string
  /** Optional secondary line. Use sparingly — most toasts work with just message. */
  detail?:   string
  /** Visual tone — "neutral" is the default voice; "pos" for affirmative
   *  moments (save, win); "warn" for attention (price drop, stale).
   *  No "error" — errors aren't a toast surface, they're inline. */
  tone?:     "neutral" | "pos" | "warn"
  /** Optional action button at the right. */
  action?:   ToastAction
  /** Auto-dismiss in ms. Default 3500. Set to 0 for sticky (rare). */
  duration?: number
}

// Subscribers + active queue. Module-level singleton — toasts are app-wide.
let queue: Toast[] = []
const subscribers = new Set<() => void>()

function notify() {
  for (const s of subscribers) s()
}

/** Push a toast. Returns the toast id so you can dismiss it manually if
 *  needed. Generated id is a timestamp + random suffix; cheap collision-
 *  resistance for the brief lifetime of any toast. */
export function showToast(t: Omit<Toast, "id">): string {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const full: Toast = { duration: 3500, tone: "neutral", ...t, id }
  queue = [...queue, full]
  notify()
  if (full.duration && full.duration > 0) {
    setTimeout(() => dismissToast(id), full.duration)
  }
  return id
}

export function dismissToast(id: string) {
  const before = queue.length
  queue = queue.filter((t) => t.id !== id)
  if (queue.length !== before) notify()
}

/** Hook for the ToastHost component — subscribes to the queue and re-renders
 *  whenever toasts come or go. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => { subscribers.add(cb); return () => { subscribers.delete(cb) } },
    () => queue,
    () => queue,
  )
}
