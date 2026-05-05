"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** PipelineVelocityChart — area chart of deals saved per day +
 *  cumulative pipeline size, over the last 7 / 30 / 90 days.
 *
 *  Built on the dashboard-01 ChartAreaInteractive pattern (recharts +
 *  shadcn ChartContainer) but fed real `created_at` timestamps from the
 *  user's saved deals. The two series are stacked: the bottom band is
 *  net new this day, the top band is the running total carried forward.
 *
 *  Why both: "added today" tells you cadence (am I looking actively?),
 *  "running total" tells you exposure growth (is my pipeline trending
 *  up or stale?). Mercury's account-balance chart is the parallel —
 *  daily activity lives inside a longer-trend envelope. */

type DealLite = { created_at: string }

type Bucket = { date: string; added: number; total: number }

const chartConfig = {
  added: { label: "Added",   color: "var(--primary)" },
  total: { label: "Pipeline", color: "var(--primary)" },
} satisfies ChartConfig

function bucketDeals(deals: DealLite[], days: number): Bucket[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build empty buckets for the window
  const buckets: Bucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: d.toISOString().slice(0, 10), added: 0, total: 0 })
  }

  // Pre-compute deals already in pipeline at start of window
  const windowStart = new Date(buckets[0].date)
  let runningTotal = 0
  for (const deal of deals) {
    const dt = new Date(deal.created_at)
    if (dt < windowStart) runningTotal++
  }

  // Fold each deal into its bucket
  const idx = new Map(buckets.map((b, i) => [b.date, i]))
  for (const deal of deals) {
    const key = new Date(deal.created_at).toISOString().slice(0, 10)
    const i = idx.get(key)
    if (i != null) buckets[i].added++
  }

  // Carry the running total forward
  for (const b of buckets) {
    runningTotal += b.added
    b.total = runningTotal - b.added // total carried in (before today's adds)
  }

  return buckets
}

export function PipelineVelocityChart({ deals }: { deals: DealLite[] }) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState<"7d" | "30d" | "90d">("90d")

  React.useEffect(() => {
    if (isMobile) setTimeRange("7d")
  }, [isMobile])

  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90
  const data = React.useMemo(() => bucketDeals(deals, days), [deals, days])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Pipeline velocity</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Deals added per day, with running pipeline size
          </span>
          <span className="@[540px]/card:hidden">Deals added per day</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              const v = value[0] as "7d" | "30d" | "90d" | undefined
              setTimeRange(v ?? "90d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value) setTimeRange(value as "7d" | "30d" | "90d")
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">Last 3 months</SelectItem>
              <SelectItem value="30d" className="rounded-lg">Last 30 days</SelectItem>
              <SelectItem value="7d"  className="rounded-lg">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[160px] w-full">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--color-total)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="fillAdded" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--color-added)" stopOpacity={1.0} />
                <stop offset="95%" stopColor="var(--color-added)" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="total"
              type="natural"
              fill="url(#fillTotal)"
              stroke="var(--color-total)"
              stackId="a"
            />
            <Area
              dataKey="added"
              type="natural"
              fill="url(#fillAdded)"
              stroke="var(--color-added)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
