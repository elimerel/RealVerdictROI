"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Inbox } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LeadCard } from "@/components/leads/lead-card"
import { LeadDetail } from "@/components/leads/lead-detail"
import { mockLeads, getLeadById } from "@/lib/mock-data"
import type { Lead } from "@/lib/types"

function LeadsContent() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") || mockLeads[0]?.id
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  useEffect(() => {
    if (initialId) {
      const lead = getLeadById(initialId)
      if (lead) setSelectedLead(lead)
    }
  }, [initialId])

  return (
    <ResizablePanelGroup direction="horizontal" className="h-[calc(100vh-3.5rem)]">
      <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
        <ScrollArea className="h-full">
          <div className="divide-y divide-border">
            {mockLeads.map((lead) => (
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

export default function LeadsPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" />
          <span>Leads Inbox</span>
          <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
            {mockLeads.length}
          </span>
        </div>
      </header>
      <Suspense fallback={<div className="h-[calc(100vh-3.5rem)] animate-pulse bg-muted/20" />}>
        <LeadsContent />
      </Suspense>
    </SidebarInset>
  )
}
