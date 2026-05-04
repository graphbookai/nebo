import { memo, useCallback, useMemo } from 'react'
import type { ChartConfiguration, ChartEvent, ActiveElement, Chart } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { shapeForLabel } from './scatterShape'
import { RUN_COLOR_PALETTE } from '@/lib/colors'
import { useStore } from '@/store'

// Hex-to-rgba; mirrors HistogramMetric's withAlpha. Used to dim points that
// don't match the active step filter.
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

type ScatterPoint = { x: number; y: number; step: number | null }

// Each entry's `value` is `{label: {x: [...], y: [...]}}`. Scatter
// accumulates: every emission contributes more points to the same plot,
// each point tagged with the emission's step. The chart shows the union
// of all points across entries; clicking a point sets the global step
// filter so the rest of the UI (logs, images, audio) narrows to that
// moment in the run.
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
  const timelineMode = useStore(s => s.timeline.mode)
  const timelineStep = useStore(s => s.timeline.step)
  const setTimelineMode = useStore(s => s.setTimelineMode)
  const setTimelineStep = useStore(s => s.setTimelineStep)

  const isFiltering = timelineMode === 'step' && timelineStep != null

  // The `colors` flag is per-name (not per-emission); take it from the
  // latest entry so toggling it via the SDK at any point flips rendering.
  const colorsByLabel =
    entries.length > 0 ? entries[entries.length - 1].colors === true : false

  // Walk every entry and concatenate per-label points, tagging each point
  // with the emission's step so click + highlight can filter by it.
  const pointsByLabel = useMemo(() => {
    const out = new Map<string, ScatterPoint[]>()
    for (const e of entries) {
      const v = e.value as Record<string, { x?: unknown; y?: unknown }> | undefined
      if (!v || typeof v !== 'object') continue
      for (const [label, series] of Object.entries(v)) {
        if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
        const xs = series.x as number[]
        const ys = series.y as number[]
        const bucket = out.get(label) ?? []
        for (let i = 0; i < xs.length; i++) {
          bucket.push({ x: xs[i], y: ys[i], step: e.step ?? null })
        }
        out.set(label, bucket)
      }
    }
    return out
  }, [entries])

  const datasets = useMemo(() => {
    const out: {
      label: string
      data: ScatterPoint[]
      backgroundColor: string | string[]
      borderColor: string | string[]
      borderWidth: number | number[]
      pointStyle: string
      pointRadius: number | number[]
    }[] = []
    for (const [label, points] of pointsByLabel) {
      const labelColor = colorsByLabel
        ? RUN_COLOR_PALETTE[allLabels.indexOf(label) % RUN_COLOR_PALETTE.length]
        : color
      const dimmed = withAlpha(labelColor, 0.25)

      // Per-point styling so the active-step points pop without splitting
      // into a second dataset (which would double label entries / break
      // the legend's 1:1 with the SDK's `value` keys).
      const bg: string[] = []
      const radius: number[] = []
      const borderW: number[] = []
      for (const p of points) {
        const isActive = isFiltering && p.step === timelineStep
        if (isFiltering && !isActive) {
          bg.push(dimmed)
          radius.push(3)
          borderW.push(0)
        } else {
          bg.push(labelColor)
          radius.push(isActive ? 7 : 4)
          borderW.push(isActive ? 1.5 : 0.5)
        }
      }

      out.push({
        label,
        data: points,
        backgroundColor: bg,
        borderColor: tokens.tooltipFg,
        borderWidth: borderW,
        pointStyle: shapeForLabel(label, allLabels),
        pointRadius: radius,
      })
    }
    return out
  }, [pointsByLabel, color, colorsByLabel, allLabels, tokens.tooltipFg, isFiltering, timelineStep])

  const handleClick = useCallback(
    (_evt: ChartEvent, elements: ActiveElement[], chart: Chart) => {
      if (!elements.length) return
      const el = elements[0]
      const ds = chart.data.datasets[el.datasetIndex] as { data: ScatterPoint[] } | undefined
      const point = ds?.data?.[el.index]
      if (!point || point.step == null) return
      if (timelineMode === 'step' && timelineStep === point.step) {
        // Toggle off when clicking the same point again.
        setTimelineStep(null)
        return
      }
      if (timelineMode !== 'step') setTimelineMode('step')
      setTimelineStep(point.step)
    },
    [timelineMode, timelineStep, setTimelineMode, setTimelineStep],
  )

  const config: ChartConfiguration<'scatter'> = useMemo(
    () => ({
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        onClick: handleClick,
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
    [datasets, tokens.axisTickColor, tokens.gridStroke, handleClick],
  )

  const { canvasRef, containerRef } = useChartJs<'scatter'>({
    config,
    formatTooltip: (tooltip) => ({
      title: undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as { label?: string; backgroundColor?: string | string[] }
        const xy = dp.parsed as { x: number; y: number }
        const raw = (dp.raw as ScatterPoint | undefined) ?? null
        const bg = Array.isArray(ds.backgroundColor)
          ? ds.backgroundColor[dp.dataIndex] ?? color
          : ds.backgroundColor ?? color
        const stepSuffix = raw?.step != null ? ` · step ${raw.step}` : ''
        return {
          label: `${String(ds.label ?? '')}${stepSuffix}`,
          value: `(${xy.x.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}, ${xy.y.toLocaleString(undefined, { maximumFractionDigits: 4 })})`,
          color: bg,
        }
      }),
    }),
  })

  // Keep the canvas mounted even when there are zero datasets (e.g.
  // every label chip toggled off). Returning null here would detach the
  // DOM canvas; useChartJs's mount effect has `[]` deps and would not
  // re-create the Chart instance when the canvas remounts later, so the
  // plot would stay stuck even after a label is toggled back on.
  return (
    <div ref={containerRef} className={`relative ${fill ? 'h-full' : 'h-[200px]'}`}>
      <canvas ref={canvasRef} className="cursor-crosshair" />
      {isFiltering && (
        <span className="absolute top-1 right-1 text-[10px] font-medium text-primary-foreground bg-primary/80 rounded px-1.5 py-px pointer-events-none z-10">
          step {timelineStep}
        </span>
      )}
    </div>
  )
})
