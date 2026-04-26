"use client"

import { MapPin, Bed, Bath, Ruler, Calendar, Home } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DealGradeBadge } from "@/components/analysis/deal-grade-badge"
import { FinancialTable, KeyRatiosTable } from "@/components/analysis/financial-table"
import { SensitivitySliders } from "@/components/analysis/sensitivity-sliders"
import { VerdictDisplay } from "@/components/analysis/verdict-display"
import { AIStrategist } from "@/components/analysis/ai-strategist"
import { ProjectionChart } from "@/components/charts/projection-chart"
import type { Lead } from "@/lib/types"

interface LeadDetailProps {
  lead: Lead
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

export function LeadDetail({ lead }: LeadDetailProps) {
  const { propertyFacts, inputs, outputs, provenance, verdict } = lead

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Property Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <DealGradeBadge grade={lead.grade} size="lg" />
              <h1 className="text-xl font-semibold">{propertyFacts.address}</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>
                {propertyFacts.city}, {propertyFacts.state} {propertyFacts.zip}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-mono font-semibold tabular-nums">
              {formatCurrency(inputs.purchase.purchasePrice)}
            </p>
            <p className="text-sm text-muted-foreground">List Price</p>
          </div>
        </div>

        {/* Property Details */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Bed className="h-4 w-4" />
            <span>
              <span className="text-foreground font-medium">
                {propertyFacts.beds}
              </span>{" "}
              beds
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Bath className="h-4 w-4" />
            <span>
              <span className="text-foreground font-medium">
                {propertyFacts.baths}
              </span>{" "}
              baths
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Ruler className="h-4 w-4" />
            <span>
              <span className="text-foreground font-medium">
                {propertyFacts.sqft.toLocaleString()}
              </span>{" "}
              sqft
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              Built{" "}
              <span className="text-foreground font-medium">
                {propertyFacts.yearBuilt}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Home className="h-4 w-4" />
            <span className="text-foreground font-medium">
              {propertyFacts.propertyType}
            </span>
          </div>
        </div>

        {/* Key Ratios */}
        <KeyRatiosTable ratios={outputs.ratios} />

        {/* Two Column Layout */}
        <div className="grid grid-cols-2 gap-4">
          {/* Upfront Costs */}
          <FinancialTable
            title="Upfront Costs"
            rows={[
              {
                label: "Purchase Price",
                value: inputs.purchase.purchasePrice,
                provenance: provenance.purchasePrice,
              },
              {
                label: "Down Payment",
                value: outputs.upfront.downPayment,
              },
              {
                label: "Loan Amount",
                value: outputs.upfront.loanAmount,
              },
              {
                label: "Closing Costs",
                value: outputs.upfront.closingCosts,
              },
              {
                label: "Rehab Costs",
                value: inputs.purchase.rehabCosts,
              },
              {
                label: "Total Cash Invested",
                value: outputs.upfront.totalCashInvested,
                isHeader: true,
              },
            ]}
          />

          {/* Monthly Snapshot */}
          <FinancialTable
            title="Monthly Snapshot"
            rows={[
              {
                label: "Gross Rent",
                value: outputs.monthly.monthlyGrossRent,
                provenance: provenance.monthlyRent,
              },
              {
                label: "Effective Income",
                value: outputs.monthly.monthlyEffectiveIncome,
              },
              {
                label: "Operating Expenses",
                value: -outputs.monthly.monthlyOperatingExpenses,
                highlight: "negative",
              },
              {
                label: "Mortgage (P&I)",
                value: -outputs.monthly.monthlyMortgagePayment,
                highlight: "negative",
              },
              {
                label: "Net Cash Flow",
                value: outputs.monthly.monthlyCashFlow,
                isHeader: true,
                highlight:
                  outputs.monthly.monthlyCashFlow >= 0 ? "positive" : "negative",
              },
            ]}
          />
        </div>

        {/* Annual Summary */}
        <FinancialTable
          title="Annual Summary (Year 1)"
          rows={[
            {
              label: "Gross Income",
              value: outputs.annual.annualGrossIncome,
            },
            {
              label: "Vacancy Loss",
              value: -(outputs.annual.annualGrossIncome - outputs.annual.annualEffectiveIncome),
              highlight: "negative",
            },
            {
              label: "Effective Gross Income",
              value: outputs.annual.annualEffectiveIncome,
              isHeader: true,
            },
            {
              label: "Operating Expenses",
              value: -outputs.annual.annualOperatingExpenses,
              highlight: "negative",
            },
            {
              label: "Net Operating Income (NOI)",
              value: outputs.annual.annualNOI,
              isHeader: true,
              highlight: "positive",
            },
            {
              label: "Debt Service",
              value: -outputs.annual.annualDebtService,
              highlight: "negative",
            },
            {
              label: "Annual Cash Flow",
              value: outputs.annual.annualCashFlow,
              isHeader: true,
              highlight:
                outputs.annual.annualCashFlow >= 0 ? "positive" : "negative",
            },
          ]}
        />

        {/* Exit Analysis */}
        <FinancialTable
          title={`Exit Analysis (${inputs.growthAndExit.holdPeriodYears} Year Hold)`}
          rows={[
            {
              label: "Projected Sale Price",
              value: outputs.exit.salePrice,
            },
            {
              label: "Selling Costs",
              value: -outputs.exit.sellingCosts,
              highlight: "negative",
            },
            {
              label: "Loan Balance at Exit",
              value: -outputs.exit.loanBalanceAtExit,
              highlight: "negative",
            },
            {
              label: "Net Sale Proceeds",
              value: outputs.exit.netSaleProceeds,
              isHeader: true,
            },
            {
              label: "Total Cash Flow",
              value: outputs.exit.totalCashFlow,
              highlight:
                outputs.exit.totalCashFlow >= 0 ? "positive" : "negative",
            },
            {
              label: "Total Profit",
              value: outputs.exit.totalProfit,
              isHeader: true,
              highlight: "positive",
            },
            {
              label: "Total ROI",
              value: `${outputs.exit.totalROI.toFixed(1)}%`,
              isHeader: true,
              highlight: "positive",
            },
          ]}
        />

        {/* Projection Chart */}
        <ProjectionChart projections={outputs.projections} />

        {/* Sensitivity Analysis */}
        <SensitivitySliders
          purchasePrice={inputs.purchase.purchasePrice}
          interestRate={inputs.financing.loanInterestRate}
          monthlyRent={inputs.income.monthlyRent}
          vacancyRate={inputs.income.vacancyRatePercent}
          appreciationRate={inputs.growthAndExit.annualAppreciationPercent}
          managementRate={inputs.operatingExpenses.propertyManagementPercent}
        />

        {/* Verdict Display */}
        <VerdictDisplay verdict={verdict} />

        {/* AI Strategist */}
        <AIStrategist lead={lead} />
      </div>
    </ScrollArea>
  )
}
