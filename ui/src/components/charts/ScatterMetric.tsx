import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { shapeForLabel } from './scatterShape'
import { RUN_COLOR_PALETTE } from '@/lib/colors'

// Each entry's `value` is `{label: {x: [...], y: [...]}}`. Every label
// becomes its own dataset; pointStyle is keyed by label so the same label
// uses the same shape across runs and across emissions.
//
// `colors=false` (default) draws every series in the run color and lets
// shape carry the label distinction. `colors=true` switches to the shared
// palette so labels can be distinguished by color too — useful for
// single-run scatters, ambiguous in comparison views (where the palette is
// reserved for run identity).
export const ScatterMetric = memo(function ScatterMetric({
  entries,
  color,
  allLabels,
  fill,
}: {
  entries: MetricEntry[]
  color: string
  allLabels: string[]
  // Fill the parent's height instead of the default 200px (grid card mode).
  fill?: boolean
}) {
  const tokens = useChartTokens()

  // Snapshot semantics: scatter overwrites on re-emission, so only the
  // latest entry carries data.
  const latest = entries.length > 0 ? entries[entries.length - 1] : null
  const colorsByLabel = latest?.colors === true

  const datasets = useMemo(() => {
    if (!latest) return []
    const v = latest.value as Record<string, { x?: unknown; y?: unknown }> | undefined
    if (!v || typeof v !== 'object') return []
    const out: {
      label: string
      data: { x: number; y: number }[]
      backgroundColor: string
      borderColor: string
      borderWidth: number
      pointStyle: string
      pointRadius: number
    }[] = []
    for (const [label, series] of Object.entries(v)) {
      if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
      const xs = series.x as number[]
      const ys = series.y as number[]
      const data = xs.map((x, i) => ({ x, y: ys[i] }))
      const labelColor = colorsByLabel
        ? RUN_COLOR_PALETTE[allLabels.indexOf(label) % RUN_COLOR_PALETTE.length]
        : color
      out.push({
        label,
        data,
        backgroundColor: labelColor,
        borderColor: tokens.tooltipFg,
        borderWidth: 0.5,
        pointStyle: shapeForLabel(label, allLabels),
        pointRadius: 4,
      })
    }
    return out
  }, [latest, color, colorsByLabel, allLabels, tokens.tooltipFg])

  const config: ChartConfiguration<'scatter'> = useMemo(
    () => ({
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
          y: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    }),
    [datasets, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'scatter'>({
    config,
    formatTooltip: (tooltip) => ({
      title: undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as { label?: string; backgroundColor?: string }
        const xy = dp.parsed as { x: number; y: number }
        return {
          label: String(ds.label ?? ''),
          value: `(${xy.x.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}, ${xy.y.toLocaleString(undefined, { maximumFractionDigits: 4 })})`,
          color: ds.backgroundColor ?? color,
        }
      }),
    }),
  })

  if (datasets.length === 0) return null

  return (
    <div ref={containerRef} className={fill ? 'h-full' : 'h-[200px]'}>
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
