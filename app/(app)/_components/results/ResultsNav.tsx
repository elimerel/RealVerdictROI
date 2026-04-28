"use client"

import Link from "next/link"
import { useLayoutEffect, useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, Save, Check, Loader2 } from "lucide-react"
import type { DealInputs } from "@/lib/calculations"

type Props = {
  editHref: string
  currentUrl: string
  supabaseConfigured: boolean
  signedIn: boolean
  // Only needed in Electron save path
  inputs?: DealInputs
  address?: string
  isPro?: boolean
}

export function ResultsNav({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
  inputs,
  address,
  isPro,
}: Props) {
  const [isElectron, setIsElectron] = useState(false)
  const searchParams = useSearchParams()
  const fromElec = searchParams.get("fromelec") === "1"

  useLayoutEffect(() => {
    setIsElectron(!!window.electronAPI)
  }, [])

  if (isElectron) {
    return (
      <nav className="flex items-center gap-3 sm:gap-4 text-sm">
        {fromElec && (
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-1 font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            <ChevronLeft className="h-4 w-4" />
            Research
          </button>
        )}
        <Link
          href={editHref}
          className="font-medium text-zinc-400 transition hover:text-zinc-100"
        >
          Edit
        </Link>
        <Link
          href="/compare"
          className="font-medium text-zinc-400 transition hover:text-zinc-100"
        >
          Compare
        </Link>
        {supabaseConfigured && signedIn && inputs && (
          <ElectronSaveButton
            inputs={inputs}
            address={address}
            currentUrl={currentUrl}
            isPro={isPro ?? false}
            autoSave={fromElec}
          />
        )}
        {supabaseConfigured && !signedIn && (
          <Link
            href={`/dashboard`}
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Deals
          </Link>
        )}
      </nav>
    )
  }

  // Web nav — unchanged
  return (
    <nav className="flex items-center gap-3 sm:gap-5 text-sm">
      <Link href={editHref} className="font-medium text-zinc-400 transition hover:text-zinc-100">
        Edit
      </Link>
      <Link href="/compare" className="font-medium text-zinc-400 transition hover:text-zinc-100">
        Compare
      </Link>
      <Link href="/pricing" className="hidden sm:inline font-medium text-zinc-400 transition hover:text-zinc-100">
        Pricing
      </Link>
      {supabaseConfigured && (
        signedIn ? (
          <Link href="/deals" className="font-medium text-zinc-400 transition hover:text-zinc-100">
            Deals
          </Link>
        ) : (
          <Link
            href={`/login?redirect=${encodeURIComponent(currentUrl)}`}
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Sign in
          </Link>
        )
      )}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Compact save button for Electron header — auto-saves once when autoSave=true
// ---------------------------------------------------------------------------

function ElectronSaveButton({
  inputs,
  address,
  currentUrl,
  isPro,
  autoSave,
}: {
  inputs: DealInputs
  address?: string
  currentUrl: string
  isPro: boolean
  autoSave: boolean
}) {
  type St = "idle" | "saving" | "saved" | "error"
  const [state, setState] = useState<St>("idle")
  const didAutoSave = useRef(false)

  const searchParams = useSearchParams()

  const save = async () => {
    if (state === "saving" || state === "saved") return
    if (!isPro) return
    setState("saving")
    try {
      const propertyFacts = {
        beds:         searchParams.get("beds")         ? Number(searchParams.get("beds"))         : null,
        baths:        searchParams.get("baths")        ? Number(searchParams.get("baths"))        : null,
        sqft:         searchParams.get("sqft")         ? Number(searchParams.get("sqft"))         : null,
        yearBuilt:    searchParams.get("yearBuilt")    ? Number(searchParams.get("yearBuilt"))    : null,
        propertyType: searchParams.get("propertyType") ?? null,
      }
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address, propertyFacts }),
      })
      if (!res.ok) throw new Error("save failed")
      setState("saved")
    } catch {
      setState("error")
    }
  }

  useEffect(() => {
    if (autoSave && isPro && !didAutoSave.current) {
      didAutoSave.current = true
      void save()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, isPro])

  if (!isPro) {
    return (
      <Link
        href={`/pricing?redirect=${encodeURIComponent(currentUrl)}`}
        className="font-medium text-zinc-400 transition hover:text-zinc-100"
      >
        Save (Pro)
      </Link>
    )
  }

  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-emerald-400 font-medium">
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    )
  }

  return (
    <button
      onClick={save}
      disabled={state === "saving"}
      className="flex items-center gap-1 font-medium text-zinc-400 transition hover:text-zinc-100 disabled:opacity-50"
    >
      {state === "saving"
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Save className="h-3.5 w-3.5" />}
      {state === "error" ? "Retry save" : "Save"}
    </button>
  )
}
