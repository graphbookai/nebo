import { memo, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartAxisTick, chartGridStroke, chartHiddenWrapper } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

const MAX_DISPLAY_POINTS = 500

type LinePoint = { step: number; value: number }

function toLinePoints(entries: MetricEntry[]): LinePoint[] {
  const points: LinePoint[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const step = e.step ?? i
    const value = typeof e.value === 'number' ? e.value : Number(e.value)
    if (Number.isFinite(value)) {
      points.push({ step, value })
    }
  }
  return points
}

function downsample(series: LinePoint[]): LinePoint[] {
  if (series.length <= MAX_DISPLAY_POINTS) return series
  const step = Math.ceil(series.length / MAX_DISPLAY_POINTS)
  const result: LinePoint[] = []
  for (let i = 0; i < series.length; i += step) {
    result.push(series[i])
  }
  if (result[result.length - 1] !== series[series.length - 1]) {
    result.push(series[series.length - 1])
  }
  return result
}

export const LineMetric = memo(function LineMetric({
  entries,
  color,
}: {
  entries: MetricEntry[]
  color: string
}) {
  const data = useMemo(() => downsample(toLinePoints(entries)), [entries])
  if (data.length === 0) return null
  return (
    <div className="h-[120px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
          <XAxis dataKey="step" tick={chartAxisTick} tickLine={false} axisLine={false} />
          <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            wrapperStyle={chartHiddenWrapper}
            content={
              <PortalTooltip
                labelFormatter={(step) => `Step ${step}`}
                formatter={(value) => [
                  typeof value === 'number' ? value.toFixed(4) : String(value ?? ''),
                  'value',
                ]}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})
