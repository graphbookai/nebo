// Renders a single loggable's metrics tab. Works for node- and global-kind
// loggables, for a single run, and in multi-run comparison.
//
// Color conventions:
//   - In a single-run view, every chart is drawn in the run's color (the same
//     color the UI uses for the run elsewhere). Shapes/opacity distinguish
//     within-run step or category variation.
//   - In comparison, each run's data is drawn in that run's color; lines,
//     bars, histograms, and scatters stack/overlay across runs.
//
// Filter chips above each chart let the user toggle:
//   - tag chips (the tags the user attached via `tags=`)
//   - step chips (each emission's step number)
//   - run chips (only in comparison)
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import type { MetricEntry, LoggableMetricSeries } from '@/lib/api'
import { LineMetric } from '@/components/charts/LineMetric'
import { BarMetric } from '@/components/charts/BarMetric'
import { PieMetric } from '@/components/charts/PieMetric'
import { ScatterMetric } from '@/components/charts/ScatterMetric'
import { HistogramMetric } from '@/components/charts/HistogramMetric'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import {
  chartAxisTick,
  chartBarCursor,
  chartGridStroke,
  chartHiddenWrapper,
  chartScatterCursor,
} from '@/components/charts/chartStyles'
import { PortalTooltip } from '@/components/charts/PortalTooltip'

const SCATTER_SHAPES = ['circle', 'cross', 'diamond', 'square', 'star', 'triangle', 'wye'] as const
type ScatterShape = (typeof SCATTER_SHAPES)[number]

interface NodeMetricsProps {
  runId: string
  loggableId: string
  comparisonRunIds?: string[]
}

export function NodeMetrics({ runId, loggableId, comparisonRunIds }: NodeMetricsProps) {
  if (comparisonRunIds) {
    return <ComparisonMetrics loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
  }
  return <SingleRunMetrics runId={runId} loggableId={loggableId} />
}

function SingleRunMetrics({ runId, loggableId }: { runId: string; loggableId: string }) {
  const metrics = useStore(s => s.runs.get(runId)?.loggableMetrics[loggableId]) ?? {}
  const runColor = useStore(s => s.runColors.get(runId)) ?? '#60a5fa'
  const getOrAssignRunColor = useStore(s => s.getOrAssignRunColor)

  // Make sure this run has an assigned color — the store lazily assigns on demand.
  useEffect(() => {
    getOrAssignRunColor(runId)
  }, [runId, getOrAssignRunColor])

  if (Object.keys(metrics).length === 0) {
    return <p className="text-xs text-muted-foreground">No metrics for this loggable</p>
  }

  return (
    <div className="space-y-4">
      {Object.entries(metrics).map(([name, series]) => (
        <MetricBlock key={name} name={name} series={series} color={runColor} />
      ))}
    </div>
  )
}

const UNTAGGED_KEY = '__untagged__'

function MetricBlock({
  name,
  series,
  color,
}: {
  name: string
  series: LoggableMetricSeries
  color: string
}) {
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    let hasUntagged = false
    for (const e of series.entries) {
      if (e.tags.length === 0) hasUntagged = true
      for (const t of e.tags) tags.add(t)
    }
    const out = [...tags].sort()
    if (hasUntagged) out.unshift(UNTAGGED_KEY)
    return out
  }, [series.entries])

  // All chips start selected so nothing is hidden by default. As new tags
  // stream in, they join the active set, keeping their entries visible.
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set(allTags))
  useEffect(() => {
    setActiveTags(prev => {
      let changed = false
      const next = new Set(prev)
      for (const t of allTags) {
        if (!next.has(t)) {
          next.add(t)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allTags])

  const filtered = useMemo(() => {
    return series.entries.filter(e => {
      if (e.tags.length === 0) return activeTags.has(UNTAGGED_KEY)
      return e.tags.some(t => activeTags.has(t))
    })
  }, [series.entries, activeTags])

  const toggle = (v: string) =>
    setActiveTags(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
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
          {allTags.map(t => (
            <Chip
              key={`tag:${t}`}
              label={t === UNTAGGED_KEY ? '(untagged)' : t}
              active={activeTags.has(t)}
              onClick={() => toggle(t)}
            />
          ))}
        </div>
      )}
      <div className="mt-1">
        <SingleRunChart type={series.type} entries={filtered} color={color} />
      </div>
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'text-[10px] rounded px-1.5 py-0.5 border ' +
        (active
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted')
      }
    >
      {label}
    </button>
  )
}

function SingleRunChart({ type, entries, color }: { type: string; entries: MetricEntry[]; color: string }) {
  if (type === 'line') return <LineMetric entries={entries} color={color} />
  if (type === 'histogram') return <HistogramMetric entries={entries} color={color} />
  if (type === 'scatter') return <ScatterMetric entries={entries} color={color} />
  // bar and pie emit one chart per emission; step label above each.
  return (
    <div className="space-y-3">
      {entries.map((e, i) => {
        const stepLabel = e.step != null ? `Step ${e.step}` : `#${i}`
        return (
          <div key={`${e.timestamp}-${i}`}>
            <div className="text-[10px] text-muted-foreground mb-0.5">{stepLabel}</div>
            {type === 'bar' && <BarMetric entry={e} color={color} />}
            {type === 'pie' && <PieMetric entry={e} />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Comparison ────────────────────────────────────────────────────────────

function ComparisonMetrics({
  loggableId,
  comparisonRunIds,
}: {
  loggableId: string
  comparisonRunIds: string[]
}) {
  const runs = useStore(s => s.runs)
  const runColors = useStore(s => s.runColors)
  const runNames = useStore(s => s.runNames)
  const getOrAssignRunColor = useStore(s => s.getOrAssignRunColor)

  useEffect(() => {
    for (const rid of comparisonRunIds) getOrAssignRunColor(rid)
  }, [comparisonRunIds, getOrAssignRunColor])

  // All run chips start selected. New runs joining the comparison get
  // auto-included so nothing is hidden without a user action.
  const [activeRuns, setActiveRuns] = useState<Set<string>>(() => new Set(comparisonRunIds))
  useEffect(() => {
    setActiveRuns(prev => {
      let changed = false
      const next = new Set(prev)
      for (const rid of comparisonRunIds) {
        if (!next.has(rid)) {
          next.add(rid)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [comparisonRunIds])

  const runNameFor = (rid: string) =>
    runNames.get(rid) || runs.get(rid)?.summary.script_path.split('/').pop() || rid

  // Collect every metric name across runs, keyed by its type (use the first
  // type we see — type is locked on the SDK side anyway).
  const metricNames = useMemo(() => {
    const byName = new Map<string, string>()
    for (const rid of comparisonRunIds) {
      const runMetrics = runs.get(rid)?.loggableMetrics[loggableId]
      if (!runMetrics) continue
      for (const [name, series] of Object.entries(runMetrics)) {
        if (!byName.has(name)) byName.set(name, series.type)
      }
    }
    return byName
  }, [comparisonRunIds, runs, loggableId])

  if (metricNames.size === 0) {
    return <p className="text-xs text-muted-foreground">No metrics for this loggable</p>
  }

  const effectiveRunIds = comparisonRunIds.filter(rid => activeRuns.has(rid))

  return (
    <div className="space-y-4">
      {[...metricNames.entries()].map(([name, type]) => (
        <ComparisonMetricBlock
          key={name}
          name={name}
          type={type}
          loggableId={loggableId}
          runIds={effectiveRunIds}
          comparisonRunIds={comparisonRunIds}
          activeRuns={activeRuns}
          setActiveRuns={setActiveRuns}
          runColors={runColors}
          runNameFor={runNameFor}
        />
      ))}
    </div>
  )
}

function ComparisonMetricBlock({
  name,
  type,
  loggableId,
  runIds,
  comparisonRunIds,
  activeRuns,
  setActiveRuns,
  runColors,
  runNameFor,
}: {
  name: string
  type: string
  loggableId: string
  runIds: string[]
  comparisonRunIds: string[]
  activeRuns: Set<string>
  setActiveRuns: (updater: (prev: Set<string>) => Set<string>) => void
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
}) {
  const runs = useStore(s => s.runs)

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    let hasUntagged = false
    for (const rid of comparisonRunIds) {
      const series = runs.get(rid)?.loggableMetrics[loggableId]?.[name]
      if (!series) continue
      for (const e of series.entries) {
        if (e.tags.length === 0) hasUntagged = true
        for (const t of e.tags) tags.add(t)
      }
    }
    const out = [...tags].sort()
    if (hasUntagged) out.unshift(UNTAGGED_KEY)
    return out
  }, [comparisonRunIds, runs, loggableId, name])

  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set(allTags))
  useEffect(() => {
    setActiveTags(prev => {
      let changed = false
      const next = new Set(prev)
      for (const t of allTags) {
        if (!next.has(t)) {
          next.add(t)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allTags])

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
        <span className="text-[10px] text-muted-foreground">{type}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {comparisonRunIds.map(rid => {
          const active = activeRuns.has(rid)
          const color = runColors.get(rid) ?? '#60a5fa'
          return (
            <button
              key={rid}
              onClick={() =>
                setActiveRuns(prev => {
                  const next = new Set(prev)
                  if (next.has(rid)) next.delete(rid)
                  else next.add(rid)
                  return next
                })
              }
              className={
                'text-[10px] rounded px-1.5 py-0.5 border flex items-center gap-1 ' +
                (active
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted')
              }
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              {runNameFor(rid)}
            </button>
          )
        })}
        {allTags.map(t => (
          <Chip
            key={`tag:${t}`}
            label={t === UNTAGGED_KEY ? '(untagged)' : t}
            active={activeTags.has(t)}
            onClick={() => toggleTag(t)}
          />
        ))}
      </div>
      <div className="mt-1">
        <ComparisonChart
          type={type}
          name={name}
          loggableId={loggableId}
          runIds={runIds}
          activeTags={activeTags}
        />
      </div>
    </div>
  )
}

function ComparisonChart({
  type,
  name,
  loggableId,
  runIds,
  activeTags,
}: {
  type: string
  name: string
  loggableId: string
  runIds: string[]
  activeTags: Set<string>
}) {
  const runs = useStore(s => s.runs)
  const runColors = useStore(s => s.runColors)
  const runNames = useStore(s => s.runNames)

  const runNameFor = (rid: string) =>
    runNames.get(rid) || runs.get(rid)?.summary.script_path.split('/').pop() || rid
  const seriesFor = (rid: string) => {
    const s = runs.get(rid)?.loggableMetrics[loggableId]?.[name]
    if (!s) return undefined
    // No tag chips selected → untagged entries only. Otherwise keep entries
    // whose tag set intersects the selected chips.
    // Keep untagged entries if the (untagged) chip is active, tagged entries
    // if any of their tags are active. All chips default to selected so
    // nothing is hidden without an explicit deselect.
    const entries = s.entries.filter(e => {
      if (e.tags.length === 0) return activeTags.has(UNTAGGED_KEY)
      return e.tags.some(t => activeTags.has(t))
    })
    return { ...s, entries }
  }

  if (type === 'line') return <ComparisonLine runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'bar') return <ComparisonBar runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'histogram') return <ComparisonHistogram runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'scatter') return <ComparisonScatter runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  // pie: one pie per run (stacked)
  return (
    <div className="space-y-2">
      {runIds.map(rid => {
        const s = seriesFor(rid)
        if (!s) return null
        const latest = s.entries[s.entries.length - 1]
        if (!latest) return null
        return (
          <div key={rid}>
            <div className="text-[10px] text-muted-foreground mb-0.5">{runNameFor(rid)}</div>
            <PieMetric entry={latest} />
          </div>
        )
      })}
    </div>
  )
}

type SeriesFor = (rid: string) => LoggableMetricSeries | undefined

function ComparisonLine({ runIds, runColors, runNameFor, seriesFor }: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  const stepMap = new Map<number, Record<string, number>>()
  for (const rid of runIds) {
    const s = seriesFor(rid)
    if (!s || s.type !== 'line') continue
    for (const e of s.entries) {
      const step = e.step ?? 0
      const v = typeof e.value === 'number' ? e.value : Number(e.value)
      if (!Number.isFinite(v)) continue
      if (!stepMap.has(step)) stepMap.set(step, { step })
      stepMap.get(step)![rid] = v
    }
  }
  const data = [...stepMap.values()].sort((a, b) => a.step - b.step)
  return (
    <div className="h-[140px]">
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
                formatter={(value, dataKey) => [
                  value != null ? Number(value).toFixed(4) : '',
                  runNameFor(String(dataKey ?? '')),
                ]}
              />
            }
          />
          {runIds.map(rid => (
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
  )
}

function ComparisonBar({ runIds, runColors, runNameFor, seriesFor }: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  // Per-step chart: x = dict keys (categories), each run stacks its values.
  // Step is taken from the union of all runs' steps.
  const stepsSet = new Set<number>()
  for (const rid of runIds) {
    const s = seriesFor(rid)
    if (!s) continue
    for (const e of s.entries) stepsSet.add(e.step ?? 0)
  }
  const steps = [...stepsSet].sort((a, b) => a - b)
  return (
    <div className="space-y-3">
      {steps.map(step => {
        const categories = new Set<string>()
        const perRun: Record<string, Record<string, number>> = {}
        for (const rid of runIds) {
          const s = seriesFor(rid)
          if (!s) continue
          const e = s.entries.find(x => (x.step ?? 0) === step)
          if (!e) continue
          const v = e.value as Record<string, unknown> | undefined
          if (!v || typeof v !== 'object') continue
          perRun[rid] = {}
          for (const [k, vv] of Object.entries(v)) {
            categories.add(k)
            perRun[rid][k] = typeof vv === 'number' ? vv : Number(vv) || 0
          }
        }
        const catList = [...categories]
        const data = catList.map(cat => {
          const row: Record<string, number | string> = { category: cat }
          for (const rid of runIds) row[rid] = perRun[rid]?.[cat] ?? 0
          return row
        })
        return (
          <div key={step}>
            <div className="text-[10px] text-muted-foreground mb-0.5">Step {step}</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data}>
                <XAxis dataKey="category" tick={chartAxisTick} tickLine={false} axisLine={false} />
                <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  cursor={chartBarCursor}
                  wrapperStyle={chartHiddenWrapper}
                  content={
                    <PortalTooltip
                      formatter={(value, dataKey) => [value, runNameFor(String(dataKey ?? ''))]}
                    />
                  }
                />
                {runIds.map(rid => (
                  <Bar
                    key={rid}
                    dataKey={rid}
                    stackId="stack"
                    fill={runColors.get(rid) ?? '#60a5fa'}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}

function ComparisonHistogram({ runIds, runColors, runNameFor, seriesFor }: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  // Bin all samples across every run × every step against a shared range.
  type Slot = { rid: string; step: number; samples: number[] }
  const slots: Slot[] = []
  for (const rid of runIds) {
    const s = seriesFor(rid)
    if (!s) continue
    for (const e of s.entries) {
      if (Array.isArray(e.value)) {
        slots.push({ rid, step: e.step ?? 0, samples: e.value as number[] })
      }
    }
  }
  if (slots.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No histogram samples to compare</p>
  }
  const flat = slots.flatMap(s => s.samples)
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const NUM = 30
  const size = (max - min) / NUM || 1
  const data = Array.from({ length: NUM }, (_, i) => {
    const row: Record<string, number> = { x: min + (i + 0.5) * size }
    slots.forEach((slot, j) => {
      const key = `${slot.rid}__${slot.step}__${j}`
      let count = 0
      for (const v of slot.samples) {
        let idx = Math.floor((v - min) / size)
        if (idx < 0) idx = 0
        if (idx > NUM - 1) idx = NUM - 1
        if (idx === i) count++
      }
      row[key] = count
    })
    return row
  })
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <XAxis
          dataKey="x"
          type="number"
          tick={chartAxisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => Number(v).toFixed(2)}
        />
        <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={chartBarCursor}
          wrapperStyle={chartHiddenWrapper}
          content={
            <PortalTooltip
              labelFormatter={v => `x≈${Number(v).toFixed(2)}`}
              formatter={(value, dataKey) => {
                const [rid, step] = String(dataKey ?? '').split('__')
                return [value, `${runNameFor(rid)} · step ${step}`]
              }}
            />
          }
        />
        {slots.map((slot, j) => {
          const key = `${slot.rid}__${slot.step}__${j}`
          const color = runColors.get(slot.rid) ?? '#60a5fa'
          return (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={color}
              fill={color}
              fillOpacity={0.22}
              isAnimationActive={false}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ComparisonScatter({ runIds, runColors, runNameFor, seriesFor }: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  type Slot = { rid: string; step: number; shapeIdx: number; data: { x: number; y: number }[] }
  const slots: Slot[] = []
  let shapeIdx = 0
  for (const rid of runIds) {
    const s = seriesFor(rid)
    if (!s) continue
    for (const e of s.entries) {
      const v = e.value as { x?: unknown; y?: unknown } | undefined
      if (!v || !Array.isArray(v.x) || !Array.isArray(v.y)) continue
      const data = (v.x as number[]).map((x, i) => ({ x, y: (v.y as number[])[i] }))
      slots.push({ rid, step: e.step ?? 0, shapeIdx: shapeIdx % SCATTER_SHAPES.length, data })
      shapeIdx++
    }
  }
  if (slots.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No scatter data to compare</p>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <ZAxis range={[18, 18]} />
        <Tooltip
          cursor={chartScatterCursor}
          wrapperStyle={chartHiddenWrapper}
          content={<PortalTooltip />}
        />
        {slots.map((slot, i) => {
          const color = runColors.get(slot.rid) ?? '#60a5fa'
          const shape: ScatterShape = SCATTER_SHAPES[slot.shapeIdx]
          return (
            <Scatter
              key={`${slot.rid}-${slot.step}-${i}`}
              name={`${runNameFor(slot.rid)} · step ${slot.step}`}
              data={slot.data}
              fill={color}
              stroke="var(--color-popover-foreground)"
              strokeWidth={0.5}
              strokeOpacity={0.5}
              shape={shape}
            />
          )
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
}
