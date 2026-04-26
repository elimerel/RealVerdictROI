"use client"

import { useState } from "react"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LeadCard } from "@/components/leads/lead-card"
import { LeadDetail } from "@/components/leads/lead-detail"
import type { Lead } from "@/lib/types"

export function LeadsClient({ leads }: { leads: Lead[] }) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(leads[0] ?? null)

  if (leads.length === 0) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">No deals yet</p>
          <p className="text-xs">Analyze a property to save your first deal</p>
        </div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-[calc(100vh-3.5rem)]">
      <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
        <ScrollArea className="h-full">
          <div className="divide-y divide-border">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                isSelected={selectedLead?.id === lead.id}
                onSelect={() => setSelectedLead(lead)}
              />
            ))}
          </div>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-border" />
      <ResizablePanel defaultSize={65} minSize={50}>
        {selectedLead ? (
          <LeadDetail lead={selectedLead} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p>Select a lead to view details</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
