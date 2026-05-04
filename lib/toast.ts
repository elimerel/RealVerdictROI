"use client"

// Toast — sonner-backed.
//
// Public API stays the same (showToast/dismissToast/Toast/ToastAction)
// so every existing call site (Browse, Pipeline, Panel, Chat) keeps
// working. Internally we now route to sonner — the modern toast
// library shadcn ships. That gives us swipe-to-dismiss, stack
// animations, accessibility, and the polished 2026 look without
// touching any caller.
//
// Mount: ToastHost.tsx renders sonner's <Toaster /> instead of the
// old custom queue UI. We keep ToastHost as the mount point so
// app/(app)/layout.tsx continues to work without changes.

import { toast as sonner } from "sonner"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id:        string
  message:   string
  detail?:   string
  tone?:     "neutral" | "pos" | "warn"
  action?:   ToastAction
  duration?: number
}

/** Push a toast. Returns the sonner id so callers can dismissToast(id). */
export function showToast(t: Omit<Toast, "id">): string {
  const opts = {
    description: t.detail,
    duration:    t.duration ?? 3500,
    action:      t.action ? { label: t.action.label, onClick: t.action.onClick } : undefined,
  }
  // Tone → sonner variant. "warn" maps to sonner's `warning`; "pos" to
  // `success`; "neutral" stays default. No "error" tone exposed —
  // errors aren't a toast surface in this app.
  const id =
    t.tone === "pos"  ? sonner.success(t.message, opts) :
    t.tone === "warn" ? sonner.warning(t.message, opts) :
                        sonner(t.message, opts)
  return String(id)
}

export function dismissToast(id: string) {
  sonner.dismiss(id)
}

/** Legacy shim — the old useToasts() hook returned the queue for the
 *  custom ToastHost to render. Sonner manages its own queue, so this
 *  always returns []. ToastHost.tsx now mounts <Toaster /> instead. */
export function useToasts(): Toast[] {
  return []
}
