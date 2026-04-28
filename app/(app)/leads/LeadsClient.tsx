"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { BookmarkCheck } from "lucide-react"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  analyseDeal,
  sanitiseInputs,
  findOfferCeiling,
} from "@/lib/calculations"
import { SavedDealCard, type SavedDeal } from "./SavedDealCard"
import AnalysisPanel from "../_components/AnalysisPanel"

export function LeadsClient({ deals }: { deals: SavedDeal[] }) {
  const [selected, setSelected] = useState<SavedDeal | null>(deals[0] ?? null)
  const [panelWidth, setPanelWidth] = useState(400)
  const rightPanelRef = useRef<HTMLDivElement>(null)

  // Track the actual rendered pixel width of the right panel so
  // AnalysisPanel can choose the correct compact/expanded/focus mode.
  useEffect(() => {
    const el = rightPanelRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setPanelWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const analysis = useMemo(() => {
    if (!selected) return null
    try { return analyseDeal(sanitiseInputs(selected.inputs)) }
    catch { return selected.results }
  }, [selected])

  const walkAway = useMemo(() => {
    if (!selected) return null
    try { return findOfferCeiling(sanitiseInputs(selected.inputs)) }
    catch { return null }
  }, [selected])

  if (deals.length === 0) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-xl bg-muted/40 border border-border flex items-center justify-center">
            <BookmarkCheck className="h-5 w-5 opacity-40" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">No saved deals yet</p>
            <p className="text-xs opacity-60">Analyze a property in Research and save it to see it here</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-[calc(100vh-3.5rem)]">
      <ResizablePanel defaultSize={32} minSize={22} maxSize={48}>
        <ScrollArea className="h-full">
          <div>
            {deals.map((deal) => (
              <SavedDealCard
                key={deal.id}
                deal={deal}
                isSelected={selected?.id === deal.id}
                onSelect={() => setSelected(deal)}
              />
            ))}
          </div>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={68} minSize={52}>
        <div ref={rightPanelRef} className="h-full w-full overflow-hidden">
          {selected && analysis ? (
            <AnalysisPanel
              analysis={analysis}
              walkAway={walkAway}
              address={selected.address ?? undefined}
              inputs={selected.inputs}
              signedIn={true}
              isPro={false}
              supabaseConfigured={true}
              panelWidth={panelWidth}
              savedDealId={selected.id}
              propertyFacts={selected.property_facts ?? undefined}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <p className="text-sm">Select a deal to view details</p>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
