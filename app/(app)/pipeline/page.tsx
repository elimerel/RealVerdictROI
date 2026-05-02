"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { PanelResult } from "@/lib/electron"

interface SavedDeal {
  id: string
  created_at: string
  address: string | null
  city: string | null
  state: string | null
  list_price: number | null
  monthly_cash_flow: number | null
  cap_rate: number | null
  cash_on_cash: number | null
  dscr: number | null
  site_name: string | null
  take: string | null
}

function DealCard({ deal }: { deal: SavedDeal }) {
  const fmtCurrency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${(n * 100).toFixed(2)}%`

  const cashFlowTone = (v: number | null) => {
    if (v == null) return "text-[var(--p-t3)]"
    if (v >= 300)  return "text-[var(--good)]"
    if (v >= 0)    return "text-[var(--warn)]"
    return "text-[var(--bad)]"
  }

  const address = [deal.address, deal.city, deal.state].filter(Boolean).join(", ")
  const date    = new Date(deal.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

  return (
    <div className="flex flex-col gap-3 bg-[var(--p-surface)] border border-[var(--p-border)] rounded-2xl p-4 hover:border-[var(--p-raised)] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--p-t1)] leading-tight truncate">
            {deal.list_price ? fmtCurrency(deal.list_price) : address || "Saved deal"}
          </p>
          {address && (
            <p className="text-[11px] text-[var(--p-t3)] mt-0.5 truncate">{address}</p>
          )}
        </div>
        <span className="text-[10px] text-[var(--p-t4)] shrink-0 mt-0.5">{date}</span>
      </div>

      {deal.take && (
        <p className="text-[12px] text-[var(--p-t2)] leading-relaxed line-clamp-2">{deal.take}</p>
      )}

      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[var(--p-border-sub)]">
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">Cash Flow</p>
          <p className={`text-[13px] font-mono-nums font-medium ${cashFlowTone(deal.monthly_cash_flow)}`}>
            {deal.monthly_cash_flow != null && deal.monthly_cash_flow >= 0 ? "+" : ""}
            {fmtCurrency(deal.monthly_cash_flow)}/mo
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">Cap Rate</p>
          <p className="text-[13px] font-mono-nums text-[var(--p-t2)]">{fmtPct(deal.cap_rate)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">DSCR</p>
          <p className="text-[13px] font-mono-nums text-[var(--p-t2)]">
            {deal.dscr != null ? deal.dscr.toFixed(2) : "—"}
          </p>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 flex-1 text-center px-8 py-16">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
        style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-border)" }}
      >
        📋
      </div>
      <div>
        <p className="text-[14px] font-medium text-[var(--p-t1)]">No saved deals yet</p>
        <p className="text-[12px] text-[var(--p-t3)] mt-1 leading-relaxed">
          Browse a listing and save it to build your pipeline.
        </p>
      </div>
    </div>
  )
}

export default function PipelinePage() {
  const [deals,   setDeals]   = useState<SavedDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("deals")
      .select("id, created_at, address, city, state, list_price, monthly_cash_flow, cap_rate, cash_on_cash, dscr, site_name, take")
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else     setDeals((data ?? []) as SavedDeal[])
        setLoading(false)
      })
  }, [])

  return (
    <div className="flex flex-col h-full bg-[var(--p-bg)] text-[var(--p-t1)]">
      {/* Header */}
      <div
        className="flex items-center px-5 py-4 border-b border-[var(--p-border)] shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <h1 className="text-[15px] font-semibold text-[var(--p-t1)]">Pipeline</h1>
          <p className="text-[12px] text-[var(--p-t3)]">{deals.length} saved deal{deals.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto panel-scroll min-h-0">
        {loading && (
          <div className="flex flex-col gap-3 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-28 rounded-2xl" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center flex-1 p-8">
            <p className="text-[13px] text-[var(--bad)]">{error}</p>
          </div>
        )}

        {!loading && !error && deals.length === 0 && <EmptyState />}

        {!loading && !error && deals.length > 0 && (
          <div className="flex flex-col gap-3 p-4">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
