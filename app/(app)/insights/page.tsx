import { BarChart3, TrendingUp, MapPin, DollarSign } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const marketStats = [
  {
    title: "Avg. Cap Rate",
    value: "5.2%",
    change: "+0.3%",
    trend: "up",
    icon: TrendingUp,
  },
  {
    title: "Median Price",
    value: "$385K",
    change: "-2.1%",
    trend: "down",
    icon: DollarSign,
  },
  {
    title: "Markets Tracked",
    value: "47",
    change: "+3",
    trend: "up",
    icon: MapPin,
  },
  {
    title: "Deals Analyzed",
    value: "2,847",
    change: "+156",
    trend: "up",
    icon: BarChart3,
  },
]

export default function InsightsPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>Market Insights</span>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Market Insights
          </h1>
          <p className="text-muted-foreground mt-1">
            Track market trends and investment opportunities across regions.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4">
          {marketStats.map((stat) => (
            <Card key={stat.title} className="bg-card/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-mono font-semibold tabular-nums">
                  {stat.value}
                </p>
                <p
                  className={`text-xs font-mono mt-1 ${
                    stat.trend === "up" ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {stat.change} this month
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Placeholder for charts */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-card/50 h-80">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Cap Rate by Market
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-56 text-muted-foreground">
              <p className="text-sm">Chart visualization coming soon</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 h-80">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Price Trends (YoY)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-56 text-muted-foreground">
              <p className="text-sm">Chart visualization coming soon</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </SidebarInset>
  )
}
