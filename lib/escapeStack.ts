"use client"

// Universal Esc dismissal stack.
//
// Every dismissable surface (panel, drawer, modal, popover, palette)
// pushes its handler onto a global stack when it opens and pops it off
// when it closes. The topmost handler wins on Esc — so if both the
// sources drawer AND the panel are open, Esc closes the drawer first,
// then the next Esc closes the panel.
//
// This is what makes a 2026 app feel keyboard-native: the user trusts
// Esc to back out of whatever just appeared, and never has to mouse to
// a close button. Linear, Raycast, Superhuman all do this. Most SaaS
// apps don't — they're the difference.
//
// Usage from a component:
//
//   useEffect(() => {
//     if (!isOpen) return
//     return pushEscape(() => setOpen(false))
//   }, [isOpen])

import { useEffect } from "react"

type EscHandler = () => void

const stack: EscHandler[] = []
let listenerInstalled = false

function ensureListener() {
  if (listenerInstalled || typeof window === "undefined") return
  listenerInstalled = true
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return
    if (stack.length === 0) return
    // Don't intercept Esc when the user is mid-IME composition or actively
    // typing into a contentEditable / input — let the browser handle it
    // (e.g. Esc clears an input's autocomplete in some browsers).
    const el = document.activeElement as HTMLElement | null
    if (el && el.isContentEditable) return
    e.preventDefault()
    e.stopPropagation()
    const handler = stack[stack.length - 1]
    handler()
  }, { capture: true })
}

/** Push a dismissal handler. Returns a cleanup function — call it (or
 *  return it from useEffect) to pop the handler off the stack when the
 *  surface closes or unmounts. */
export function pushEscape(handler: EscHandler): () => void {
  ensureListener()
  stack.push(handler)
  return () => {
    const i = stack.lastIndexOf(handler)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** Hook flavor — registers `handler` whenever `isOpen` is true. The
 *  effect cleans up on unmount or when isOpen flips false. */
export function useEscape(isOpen: boolean, handler: EscHandler) {
  useEffect(() => {
    if (!isOpen) return
    return pushEscape(handler)
  }, [isOpen, handler])
}
