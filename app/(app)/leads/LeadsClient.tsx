"use client"

import { useState } from "react"
import { BookmarkCheck } from "lucide-react"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SavedDealCard, type SavedDeal } from "./SavedDealCard"
import { SavedDealDetail } from "./SavedDealDetail"

export function LeadsClient({ deals }: { deals: SavedDeal[] }) {
  const [selected, setSelected] = useState<SavedDeal | null>(deals[0] ?? null)

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
        {selected ? (
          <SavedDealDetail deal={selected} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a deal to view details</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
