import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'

const MAX_DISPLAY_POINTS = 500

type LinePoint = { x: number; y: number }

function toLinePoints(entries: MetricEntry[]): LinePoint[] {
  const points: LinePoint[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const step = e.step ?? i
    const value = typeof e.value === 'number' ? e.value : Number(e.value)
    if (Number.isFinite(value)) {
      points.push({ x: step, y: value })
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
  fill,
}: {
  entries: MetricEntry[]
  color: string
  // When true, the chart claims its parent's height instead of locking
  // to the default 120px. Used by the grid-view card body so the chart
  // fills the card's remaining space.
  fill?: boolean
}) {
  const tokens = useChartTokens()
  const data = useMemo(() => downsample(toLinePoints(entries)), [entries])

  const config: ChartConfiguration<'line'> = useMemo(
    () => ({
      type: 'line',
      data: {
        datasets: [
          {
            data,
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3, // approximates recharts' type="monotone" smoothing
          },
        ],
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
          y: {
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
        // Vertical-line cursor: hover anywhere along x picks the nearest
        // step's value. Matches recharts' default tooltip cursor; without
        // this, Chart.js's default 'nearest'+'intersect: true' would only
        // fire when the pointer is on a data point — invisible here since
        // pointRadius is 0.
        interaction: { mode: 'index', intersect: false },
      },
    }),
    [data, color, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'line'>({
    config,
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `Step ${(tooltip.dataPoints[0].parsed as { x: number }).x}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => ({
        label: 'value',
        value: (dp.parsed as { y: number }).y.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        }),
        color,
      })),
    }),
  })

  if (data.length === 0) return null

  return (
    <div ref={containerRef} className={fill ? 'h-full' : 'h-[120px]'}>
      <canvas ref={canvasRef} />
    </div>
  )
})
