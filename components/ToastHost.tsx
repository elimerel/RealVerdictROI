"use client"

// ToastHost — sonner-backed mount point.
//
// Mounts shadcn's <Toaster /> (sonner) at the app layout level. The
// toast queue, animations, swipe-to-dismiss, stacking, accessibility
// — all handled by sonner. Calls to showToast() from lib/toast.ts
// route here automatically.

import { Toaster } from "@/components/ui/sonner"

export default function ToastHost() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      duration={3500}
    />
  )
}
