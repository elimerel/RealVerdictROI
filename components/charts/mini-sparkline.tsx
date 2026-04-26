"use client"

import { Area, AreaChart, ResponsiveContainer } from "recharts"

interface MiniSparklineProps {
  data: number[]
  color?: "green" | "red" | "neutral"
  className?: string
}

export function MiniSparkline({
  data,
  color = "neutral",
  className,
}: MiniSparklineProps) {
  const chartData = data.map((value, index) => ({ value, index }))
  
  const colorMap = {
    green: {
      stroke: "oklch(0.65 0.17 145)",
      fill: "oklch(0.65 0.17 145 / 0.1)",
    },
    red: {
      stroke: "oklch(0.55 0.2 25)",
      fill: "oklch(0.55 0.2 25 / 0.1)",
    },
    neutral: {
      stroke: "oklch(0.55 0 0)",
      fill: "oklch(0.55 0 0 / 0.1)",
    },
  }

  const colors = colorMap[color]

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.fill} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={colors.stroke}
            strokeWidth={1.5}
            fill={`url(#gradient-${color})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
