import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'

const NUM_BINS = 30

function minMax(xs: number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
  }
  return { min, max }
}

function binCounts(samples: number[], min: number, size: number, bins: number): number[] {
  const counts = new Array(bins).fill(0)
  for (const s of samples) {
    let i = Math.floor((s - min) / size)
    if (i < 0) i = 0
    if (i > bins - 1) i = bins - 1
    counts[i]++
  }
  return counts
}

function withAlpha(hex: string, alpha: number): string {
  const trimmed = hex.trim()
  if (!trimmed.startsWith('#') || (trimmed.length !== 4 && trimmed.length !== 7)) {
    return trimmed
  }
  const expanded =
    trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed
  const r = parseInt(expanded.slice(1, 3), 16)
  const g = parseInt(expanded.slice(3, 5), 16)
  const b = parseInt(expanded.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const ComparisonHistogram = memo(function ComparisonHistogram({
  runIds,
  runColors,
  runNameFor,
  seriesFor,
}: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  const tokens = useChartTokens()

  const view = useMemo(() => {
    type Entry = { rid: string; label: string; samples: number[]; color: string }
    const entries: Entry[] = []
    let gMin = Infinity
    let gMax = -Infinity
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s || s.entries.length === 0) continue
      const latest = s.entries[s.entries.length - 1]
      const v = latest.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') continue
      const runColor = runColors.get(rid) ?? DEFAULT_RUN_COLOR
      for (const [label, raw] of Object.entries(v)) {
        const samples = Array.isArray(raw) ? (raw as number[]) : []
        if (samples.length === 0) continue
        entries.push({ rid, label, samples, color: runColor })
        const mm = minMax(samples)
        if (mm.min < gMin) gMin = mm.min
        if (mm.max > gMax) gMax = mm.max
      }
    }
    if (entries.length === 0 || !Number.isFinite(gMin) || !Number.isFinite(gMax)) {
      return null
    }
    const range = gMax - gMin || 1
    const size = range / NUM_BINS

    const datasets = entries.map(({ rid, label, samples, color }) => {
      const counts = binCounts(samples, gMin, size, NUM_BINS)
      const data = counts.map((c, i) => ({ x: gMin + (i + 0.5) * size, y: c }))
      return {
        label: `${rid}::${label}`,
        data,
        borderColor: color,
        backgroundColor: withAlpha(color, 0.22),
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: 'origin' as const,
        runId: rid,
        pointLabel: label,
      }
    })
    return { datasets, min: gMin, max: gMax }
  }, [runIds, runColors, seriesFor])

  const config: ChartConfiguration<'line'> = useMemo(
    () => ({
      type: 'line',
      data: { datasets: view?.datasets ?? [] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: {
              color: tokens.axisTickColor,
              font: { size: 10 },
              callback: (value) => Number(value).toFixed(2),
            },
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
      },
    }),
    [view, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'line'>({
    config,
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `x≈${(tooltip.dataPoints[0].parsed as { x: number }).x.toFixed(2)}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as {
          borderColor?: string
          runId?: string
          pointLabel?: string
        }
        return {
          label: `${runNameFor(ds.runId ?? '')} · ${ds.pointLabel ?? ''}`,
          value: String((dp.parsed as { y: number }).y),
          color: ds.borderColor ?? DEFAULT_RUN_COLOR,
        }
      }),
    }),
  })

  if (!view) {
    return <p className="text-[10px] text-muted-foreground">No histogram data to compare</p>
  }

  return (
    <div ref={containerRef} className="h-[200px]">
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
