import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'

// Single-step bar chart. x-axis is the dict's keys (categories); every bar
// uses the same color (typically the run's color) so a chart from one run
// reads as one series.
export const BarMetric = memo(function BarMetric({
  entry,
  color,
  fill,
}: {
  entry: MetricEntry
  color: string
  // Fill the parent's height instead of the default 140px (grid card mode).
  fill?: boolean
}) {
  const tokens = useChartTokens()

  const data = useMemo(() => {
    const value = entry.value as Record<string, number> | undefined
    if (!value) return null
    const labels: string[] = []
    const values: number[] = []
    for (const [label, v] of Object.entries(value)) {
      labels.push(label)
      values.push(typeof v === 'number' ? v : Number(v) || 0)
    }
    return { labels, values }
  }, [entry.value])

  const config: ChartConfiguration<'bar'> | null = useMemo(() => {
    if (!data) return null
    return {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          {
            data: data.values,
            backgroundColor: color,
            borderColor: color,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    }
  }, [data, color, tokens.axisTickColor, tokens.gridStroke])

  const { canvasRef, containerRef } = useChartJs<'bar'>({
    config: config ?? { type: 'bar', data: { labels: [], datasets: [] } },
    formatTooltip: (tooltip) => ({
      title: undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => ({
        label: String(dp.label ?? ''),
        value:
          typeof dp.parsed === 'object' && dp.parsed && 'y' in dp.parsed
            ? (dp.parsed as { y: number }).y.toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })
            : String(dp.formattedValue ?? ''),
        color,
      })),
    }),
  })

  if (!data) return null

  return (
    <div ref={containerRef} className={fill ? 'h-full' : 'h-[140px]'}>
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
