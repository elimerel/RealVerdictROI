"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, ChevronDown, ChevronUp,
  TrendingUp, Loader2, X, ExternalLink, AlertTriangle, CheckCircle2,
} from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  sanitiseInputs,
} from "@/lib/calculations"
import { TIER_LABEL, TIER_ACCENT } from "@/lib/tier-constants"
import type { DealInputs, DealAnalysis } from "@/lib/calculations"
import type { BrowseResponse } from "@/app/api/browse/route"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionState = {
  sessionId: string
  screenshot: string
  url: string
  title: string
  isListingPage: boolean
  pageText: string
}

type AnalysisResult = {
  address?: string
  inputs: Partial<DealInputs>
  analysis: DealAnalysis
  walkAway: number | null
  siteName: string | null
  confidence: string
  screenshot: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function hostnameOf(url: string) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

// ---------------------------------------------------------------------------
// Analysis sidebar panel
// ---------------------------------------------------------------------------

function AnalysisPanel({
  result,
  onClose,
  onViewFull,
}: {
  result: AnalysisResult | null
  loading: boolean
  onClose: () => void
  onViewFull: () => void
}) {
  if (!result) return null

  const { analysis, walkAway, inputs } = result
  const tier = analysis.verdict.tier
  const accentColor = TIER_ACCENT[tier]
  const tierLabel = TIER_LABEL[tier]

  const metrics = [
    { label: "Monthly cash flow", value: formatCurrency(analysis.monthlyCashFlow, 0), accent: analysis.monthlyCashFlow >= 0 },
    { label: "Cap rate", value: formatPercent(analysis.capRate, 1) },
    { label: "Cash-on-cash", value: formatPercent(analysis.cashOnCashReturn, 1), accent: analysis.cashOnCashReturn >= 0.07 },
    { label: "DSCR", value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞" },
    { label: "GRM", value: analysis.grossRentMultiplier.toFixed(1) + "x" },
    { label: "Total cash in", value: formatCurrency(analysis.totalCashInvested, 0) },
  ]

  return (
    <div className="flex flex-col h-full border-l border-border bg-card/30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            {result.address ?? "Property Analysis"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 text-muted-foreground shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Verdict */}
          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{ backgroundColor: `${accentColor}15`, borderColor: `${accentColor}30`, borderWidth: 1 }}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: accentColor }}>
              Verdict
            </p>
            <p className="text-lg font-semibold" style={{ color: accentColor }}>{tierLabel}</p>
            <p className="text-xs text-muted-foreground">{analysis.verdict.summary}</p>
          </div>

          {/* Walk-away price */}
          {walkAway != null && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Walk-away price
              </p>
              <p className="text-xl font-semibold font-mono">{formatCurrency(walkAway, 0)}</p>
              <p className="text-xs text-muted-foreground">Max offer where the deal still clears</p>
            </div>
          )}

          {/* Key metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-md border border-border bg-muted/10 px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">{m.label}</p>
                <p className={cn("text-sm font-mono font-medium", m.accent && "text-emerald-400")}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          {/* Rubric */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Score breakdown</p>
            {analysis.verdict.breakdown.map((b) => (
              <div key={b.category} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{b.category}</span>
                <span className={cn(
                  "font-mono",
                  b.status === "pass" ? "text-emerald-400" : b.status === "warn" ? "text-amber-400" : "text-red-400"
                )}>
                  {b.points}/{b.maxPoints}
                </span>
              </div>
            ))}
          </div>

          {/* Confidence badge */}
          <p className="text-[10px] text-muted-foreground">
            Data read from {result.siteName ?? "listing page"} · confidence: {result.confidence}
          </p>

          {/* View full */}
          <Button size="sm" className="w-full gap-1.5" onClick={onViewFull}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open full analysis
          </Button>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  const [urlInput, setUrlInput] = useState("https://zillow.com")
  const [session, setSession] = useState<SessionState | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Clean up session on unmount
  useEffect(() => {
    return () => {
      if (session?.sessionId) {
        fetch("/api/browse/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
          keepalive: true,
        }).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId])

  const startSession = useCallback(async (url: string) => {
    setSessionLoading(true)
    setError(null)
    setAnalysisResult(null)
    try {
      const res = await fetch("/api/browse/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Failed to start browser session.")
      }
      const data = await res.json() as SessionState
      setSession(data)
      setUrlInput(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start browser.")
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const act = useCallback(async (action: Parameters<typeof fetch>[1] extends never ? never : unknown) => {
    if (!session || actionLoading) return
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/browse/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, action }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Action failed.")
      }
      const data = await res.json() as Omit<SessionState, "sessionId">
      setSession((prev) => prev ? { ...prev, ...data } : null)
      setUrlInput(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setActionLoading(false)
    }
  }, [session, actionLoading])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeUrl(urlInput)
    if (!url) return
    if (!session) {
      startSession(url)
    } else {
      act({ type: "navigate", url })
    }
  }

  const handleScreenshotClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!session || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    // Map displayed coords → actual 1280×800 viewport coords
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1280)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 800)
    act({ type: "click", x, y })
  }

  const handleAnalyze = async () => {
    if (!session) return
    setAnalysisLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: session.url }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Analysis failed.")
      }
      const data = await res.json() as BrowseResponse
      const sanitized = sanitiseInputs(data.inputs as Partial<DealInputs>)
      const analysis = analyseDeal(sanitized)
      const ceiling = findOfferCeiling(sanitized)
      setAnalysisResult({
        address: data.address,
        inputs: data.inputs,
        analysis,
        walkAway: ceiling.primaryTarget?.price ?? null,
        siteName: data.siteName,
        confidence: data.confidence,
        screenshot: data.screenshot,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.")
    } finally {
      setAnalysisLoading(false)
    }
  }

  const handleViewFull = () => {
    if (!analysisResult) return
    const p = new URLSearchParams()
    const i = analysisResult.inputs
    if (i.purchasePrice)            p.set("purchasePrice",            String(i.purchasePrice))
    if (i.monthlyRent)              p.set("monthlyRent",              String(i.monthlyRent))
    if (i.annualPropertyTax)        p.set("annualPropertyTax",        String(i.annualPropertyTax))
    if (i.annualInsurance)          p.set("annualInsurance",          String(i.annualInsurance))
    if (i.monthlyHOA)               p.set("monthlyHOA",               String(i.monthlyHOA))
    if (i.loanInterestRate)         p.set("loanInterestRate",         String(i.loanInterestRate))
    if (i.annualAppreciationPercent) p.set("annualAppreciationPercent", String(i.annualAppreciationPercent))
    if (analysisResult.address)     p.set("address",                  analysisResult.address)
    window.open(`/results?${p.toString()}`, "_blank")
  }

  const configured = true // server will 503 if not — let the UI try

  return (
    <SidebarInset>
      {/* Top bar */}
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        {/* Nav controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => act({ type: "back" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => act({ type: "forward" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => act({ type: "reload" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <RotateCw className={cn("h-3.5 w-3.5", actionLoading && "animate-spin")} />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://zillow.com"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Button type="submit" size="sm" disabled={sessionLoading || actionLoading}>
            {sessionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
          </Button>
        </form>

        {/* Analyze button — highlighted when on a listing page */}
        {session && (
          <Button
            size="sm"
            variant={session.isListingPage ? "default" : "outline"}
            disabled={analysisLoading}
            onClick={handleAnalyze}
            className={cn(
              "gap-1.5 shrink-0",
              session.isListingPage && "bg-emerald-600 hover:bg-emerald-500 text-white border-0"
            )}
          >
            {analysisLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <TrendingUp className="h-3.5 w-3.5" />
            }
            {analysisLoading ? "Analyzing…" : "Analyze this property"}
          </Button>
        )}
      </header>

      {/* Error bar */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Main area: browser + analysis panel */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>

        {/* Browser viewport */}
        <div className="flex-1 overflow-hidden relative bg-zinc-950 flex flex-col">
          {!session && !sessionLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Research browser</p>
                <p className="text-xs opacity-60">Type a URL above and click Go to start browsing</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {["zillow.com", "redfin.com", "realtor.com"].map((site) => (
                  <button
                    key={site}
                    onClick={() => { setUrlInput(`https://${site}`); startSession(`https://${site}`) }}
                    className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted/50 transition-colors"
                  >
                    {site}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sessionLoading && (
            <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Launching browser…</span>
            </div>
          )}

          {session && (
            <>
              {/* Screenshot — click to interact */}
              <div className="flex-1 overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${session.screenshot}`}
                  alt="Browser viewport"
                  onClick={handleScreenshotClick}
                  className={cn(
                    "w-full h-full object-cover object-top",
                    actionLoading ? "opacity-60 cursor-wait" : "cursor-crosshair"
                  )}
                  draggable={false}
                />
                {actionLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-background/80 backdrop-blur-sm rounded-full p-3">
                      <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                    </div>
                  </div>
                )}
                {/* Listing page badge */}
                {session.isListingPage && !analysisResult && (
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-medium shadow-lg">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Listing detected — click &quot;Analyze this property&quot;
                  </div>
                )}
              </div>

              {/* Scroll controls */}
              <div className="flex items-center justify-center gap-2 p-2 border-t border-border/50 bg-background/50 shrink-0">
                <button
                  onClick={() => act({ type: "scroll", direction: "up" })}
                  disabled={actionLoading}
                  className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                  {hostnameOf(session.url)}
                </span>
                <button
                  onClick={() => act({ type: "scroll", direction: "down" })}
                  disabled={actionLoading}
                  className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Analysis panel */}
        {(analysisResult || analysisLoading) && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden">
            {analysisLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground border-l border-border">
                <Loader2 className="h-6 w-6 animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Analyzing…</p>
                  <p className="text-xs opacity-60">Reading property data</p>
                </div>
              </div>
            ) : (
              <AnalysisPanel
                result={analysisResult}
                loading={analysisLoading}
                onClose={() => setAnalysisResult(null)}
                onViewFull={handleViewFull}
              />
            )}
          </div>
        )}
      </div>
    </SidebarInset>
  )
}
