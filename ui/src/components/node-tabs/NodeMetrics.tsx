// Renders a single loggable's tab; works for node- and global-kind loggables.
import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import type { MetricEntry } from '@/lib/api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { LineMetric } from '@/components/charts/LineMetric'
import { BarMetric } from '@/components/charts/BarMetric'
import { PieMetric } from '@/components/charts/PieMetric'
import { ScatterMetric } from '@/components/charts/ScatterMetric'
import { HistogramMetric } from '@/components/charts/HistogramMetric'
import { chartAxisTick, chartGridStroke, chartHiddenWrapper } from '@/components/charts/chartStyles'
import { PortalTooltip } from '@/components/charts/PortalTooltip'

interface NodeMetricsProps {
  runId: string
  loggableId: string
  comparisonRunIds?: string[]
}

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
  // Always include the last point
  if (result[result.length - 1] !== series[series.length - 1]) {
    result.push(series[series.length - 1])
  }
  return result
}

export function NodeMetrics({ runId, loggableId, comparisonRunIds }: NodeMetricsProps) {
  const metrics = useStore(s => s.runs.get(runId)?.loggableMetrics[loggableId]) ?? {}

  if (comparisonRunIds) {
    return (
      <ComparisonMetrics
        runId={runId}
        loggableId={loggableId}
        comparisonRunIds={comparisonRunIds}
      />
    )
  }

  if (Object.keys(metrics).length === 0) {
    return <p className="text-xs text-muted-foreground">No metrics for this node</p>
  }

  return (
    <div className="space-y-4">
      {Object.entries(metrics).map(([name, series]) => (
        <MetricBlock key={name} name={name} series={series} />
      ))}
    </div>
  )
}

function MetricBlock({
  name,
  series,
}: {
  name: string
  series: { type: string; entries: MetricEntry[] }
}) {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const e of series.entries) for (const t of e.tags) s.add(t)
    return [...s].sort()
  }, [series.entries])

  const filtered = useMemo(() => {
    if (activeTags.size === 0) return series.entries
    return series.entries.filter(e => e.tags.some(t => activeTags.has(t)))
  }, [series.entries, activeTags])

  const toggleTag = (t: string) =>
    setActiveTags(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{name}</span>
        <span className="text-[10px] text-muted-foreground">{series.type}</span>
      </div>
      {allTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {allTags.map(t => {
            const on = activeTags.has(t)
            return (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={
                  'text-[10px] rounded px-1.5 py-0.5 border ' +
                  (on
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted')
                }
              >
                {t}
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-1">
        {series.type === 'line' && <LineMetric entries={filtered} />}
        {series.type === 'bar' && <BarMetric entries={filtered} />}
        {series.type === 'pie' && <PieMetric entries={filtered} />}
        {series.type === 'scatter' && <ScatterMetric entries={filtered} />}
        {series.type === 'histogram' && <HistogramMetric entries={filtered} />}
      </div>
    </div>
  )
}

function ComparisonMetrics({
  loggableId,
  comparisonRunIds,
}: {
  runId: string
  loggableId: string
  comparisonRunIds: string[]
}) {
  const runs = useStore(s => s.runs)
  const runColors = useStore(s => s.runColors)
  const runNames = useStore(s => s.runNames)

  // Collect all metric names across all runs that are line-typed.
  const comparisonMetricEntries = useMemo(() => {
    const metricNames = new Set<string>()
    for (const rid of comparisonRunIds) {
      const runMetrics = runs.get(rid)?.loggableMetrics[loggableId]
      if (runMetrics) {
        for (const [name, series] of Object.entries(runMetrics)) {
          if (series.type === 'line') metricNames.add(name)
        }
      }
    }

    return Array.from(metricNames).map(metricName => {
      // Merge data: collect all steps, then for each step build a row with per-run values
      const stepMap = new Map<number, Record<string, number>>()

      for (const rid of comparisonRunIds) {
        const series = runs.get(rid)?.loggableMetrics[loggableId]?.[metricName]
        if (!series || series.type !== 'line') continue
        const downsampled = downsample(toLinePoints(series.entries))
        for (const point of downsampled) {
          if (!stepMap.has(point.step)) {
            stepMap.set(point.step, { step: point.step })
          }
          stepMap.get(point.step)![rid] = point.value
        }
      }

      const data = Array.from(stepMap.values()).sort((a, b) => a.step - b.step)
      return { name: metricName, data }
    })
  }, [comparisonRunIds, runs, loggableId])

  if (comparisonMetricEntries.length === 0) {
    return <p className="text-xs text-muted-foreground">No metrics for this node</p>
  }

  return (
    <div className="space-y-4">
      {comparisonMetricEntries.map(({ name, data }) => (
        <div key={name}>
          <span className="text-xs font-medium text-foreground">{name}</span>
          <div className="h-[120px] mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="step" tick={chartAxisTick} tickLine={false} axisLine={false} />
                <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  wrapperStyle={chartHiddenWrapper}
                  content={
                    <PortalTooltip
                      labelFormatter={step => `Step ${step}`}
                      formatter={(value, dataKey) => {
                        const key = String(dataKey ?? '')
                        const displayName =
                          runNames.get(key) ||
                          runs.get(key)?.summary.script_path.split('/').pop() ||
                          key
                        return [value != null ? Number(value).toFixed(4) : '', displayName]
                      }}
                    />
                  }
                />
                {comparisonRunIds.map(rid => (
                  <Line
                    key={rid}
                    type="monotone"
                    dataKey={rid}
                    stroke={runColors.get(rid) ?? '#60a5fa'}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-1">
            {comparisonRunIds.map(rid => {
              const color = runColors.get(rid) ?? '#60a5fa'
              const displayName =
                runNames.get(rid) ||
                runs.get(rid)?.summary.script_path.split('/').pop() ||
                rid
              return (
                <div key={rid} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[10px] text-muted-foreground">{displayName}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
