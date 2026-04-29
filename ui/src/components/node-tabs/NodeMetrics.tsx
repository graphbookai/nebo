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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import type { MetricEntry, LoggableMetricSeries } from '@/lib/api'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
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
import { ShapeIcon } from '@/components/charts/ShapeIcon'
import {
  UNTAGGED_KEY,
  entriesMatchingTags,
  scatterLabels,
  shapeForLabel,
} from '@/components/charts/scatterShape'
import { useTagChips } from '@/components/charts/useTagChips'

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
  const runColor = useStore(s => s.runColors.get(runId)) ?? DEFAULT_RUN_COLOR
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

export function MetricBlock({
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
    // Only surface the (untagged) chip when tags ARE used elsewhere on this
    // metric — otherwise every entry is untagged and the chip is noise.
    if (hasUntagged && tags.size > 0) out.unshift(UNTAGGED_KEY)
    return out
  }, [series.entries])

  const { active: activeTags, toggle } = useTagChips(allTags)

  // Scatter dict keys (the per-emission `{label: {x,y}}` keys) drive a
  // second chip row that turns whole sub-series on or off — this is the
  // analogue of toggling slices in a pie or columns in a bar chart.
  const allLabels = useMemo(
    () => series.type === 'scatter' ? scatterLabels(series.entries) : [],
    [series.type, series.entries],
  )
  const { active: activeLabels, toggle: toggleLabel } = useTagChips(allLabels)

  const tagFiltered = useMemo(
    // When no tag chips exist (e.g. nothing was ever tagged on this metric),
    // skip filtering — otherwise every entry, having neither tags nor an
    // active (untagged) chip to satisfy, gets excluded.
    () => allTags.length === 0 ? series.entries : entriesMatchingTags(series.entries, activeTags),
    [series.entries, activeTags, allTags],
  )

  // Drop labels that the user has toggled off. Done here, not inside
  // ScatterMetric, so the per-label shape index in `allLabels` stays
  // stable while only the rendered slots change.
  const filtered = useMemo(() => {
    if (series.type !== 'scatter' || allLabels.length === 0) return tagFiltered
    return tagFiltered
      .map(e => {
        const v = e.value as Record<string, unknown> | undefined
        if (!v || typeof v !== 'object') return e
        const kept: Record<string, unknown> = {}
        for (const k of Object.keys(v)) if (activeLabels.has(k)) kept[k] = v[k]
        return { ...e, value: kept }
      })
      // Hide entries whose labels are all toggled off, so we don't render
      // an empty chart slot for them.
      .filter(e => Object.keys(e.value as Record<string, unknown>).length > 0)
  }, [series.type, tagFiltered, activeLabels, allLabels.length])

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
      {allLabels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {allLabels.map(l => (
            <Chip
              key={`label:${l}`}
              label={l}
              active={activeLabels.has(l)}
              onClick={() => toggleLabel(l)}
              icon={<ShapeIcon shape={shapeForLabel(l, allLabels)} color={color} />}
            />
          ))}
        </div>
      )}
      <div className="mt-1">
        <SingleRunChart
          type={series.type}
          entries={filtered}
          color={color}
          allLabels={allLabels}
        />
      </div>
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'text-[10px] rounded px-1.5 py-0.5 border flex items-center gap-1 ' +
        (active
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted')
      }
    >
      {icon}
      {label}
    </button>
  )
}

function SingleRunChart({
  type,
  entries,
  color,
  allLabels,
}: {
  type: string
  entries: MetricEntry[]
  color: string
  allLabels: string[]
}) {
  if (type === 'line') return <LineMetric entries={entries} color={color} />
  if (type === 'histogram') return <HistogramMetric entries={entries} color={color} />
  if (type === 'scatter') return <ScatterMetric entries={entries} color={color} allLabels={allLabels} />
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

  // All run chips start selected. Only *newly appearing* runs get auto-added
  // to activeRuns; reaffirming the current set from a WS update must not
  // resurrect a run the user deselected.
  const [activeRuns, setActiveRuns] = useState<Set<string>>(() => new Set(comparisonRunIds))
  const seenRuns = useRef<Set<string>>(new Set(comparisonRunIds))
  useEffect(() => {
    const fresh: string[] = []
    for (const rid of comparisonRunIds) {
      if (!seenRuns.current.has(rid)) {
        seenRuns.current.add(rid)
        fresh.push(rid)
      }
    }
    if (fresh.length === 0) return
    setActiveRuns(prev => {
      const next = new Set(prev)
      for (const rid of fresh) next.add(rid)
      return next
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
    if (hasUntagged && tags.size > 0) out.unshift(UNTAGGED_KEY)
    return out
  }, [comparisonRunIds, runs, loggableId, name])

  const { active: activeTags, toggle: toggleTag } = useTagChips(allTags)

  // For scatter, also collect the union of dict-key labels across runs so
  // the user can hide whole sub-series the way bar/pie users hide categories.
  const allLabels = useMemo(() => {
    if (type !== 'scatter') return [] as string[]
    const labels = new Set<string>()
    for (const rid of comparisonRunIds) {
      const series = runs.get(rid)?.loggableMetrics[loggableId]?.[name]
      if (!series) continue
      for (const e of series.entries) {
        const v = e.value
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const k of Object.keys(v as Record<string, unknown>)) labels.add(k)
        }
      }
    }
    return [...labels].sort()
  }, [type, comparisonRunIds, runs, loggableId, name])

  const { active: activeLabels, toggle: toggleLabel } = useTagChips(allLabels)

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{name}</span>
        <span className="text-[10px] text-muted-foreground">{type}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {comparisonRunIds.map(rid => {
          const active = activeRuns.has(rid)
          const color = runColors.get(rid) ?? DEFAULT_RUN_COLOR
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
      {allLabels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {allLabels.map(l => (
            <Chip
              key={`label:${l}`}
              label={l}
              active={activeLabels.has(l)}
              onClick={() => toggleLabel(l)}
              // Color-neutral on the chip; the point's color is the run's.
              icon={<ShapeIcon shape={shapeForLabel(l, allLabels)} color="var(--color-popover-foreground)" />}
            />
          ))}
        </div>
      )}
      <div className="mt-1">
        <ComparisonChart
          type={type}
          name={name}
          loggableId={loggableId}
          runIds={runIds}
          activeTags={activeTags}
          activeLabels={activeLabels}
          allLabels={allLabels}
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
  activeLabels,
  allLabels,
}: {
  type: string
  name: string
  loggableId: string
  runIds: string[]
  activeTags: Set<string>
  activeLabels: Set<string>
  allLabels: string[]
}) {
  const runs = useStore(s => s.runs)
  const runColors = useStore(s => s.runColors)
  const runNames = useStore(s => s.runNames)

  const runNameFor = (rid: string) =>
    runNames.get(rid) || runs.get(rid)?.summary.script_path.split('/').pop() || rid
  const seriesFor = useCallback(
    (rid: string) => {
      const s = runs.get(rid)?.loggableMetrics[loggableId]?.[name]
      if (!s) return undefined
      const tagFiltered = entriesMatchingTags(s.entries, activeTags)
      // Drop deselected scatter labels here so the comparison renderer
      // only sees the slots the user wants. Pie and bar values are
      // also dicts but we leave them untouched — their toggling story
      // lives in their own legend/category rendering, not this chip row.
      if (s.type === 'scatter' && allLabels.length > 0) {
        const trimmed = tagFiltered
          .map(e => {
            const v = e.value as Record<string, unknown> | undefined
            if (!v || typeof v !== 'object') return e
            const kept: Record<string, unknown> = {}
            for (const k of Object.keys(v)) if (activeLabels.has(k)) kept[k] = v[k]
            return { ...e, value: kept }
          })
          .filter(e => Object.keys(e.value as Record<string, unknown>).length > 0)
        return { ...s, entries: trimmed }
      }
      return { ...s, entries: tagFiltered }
    },
    [runs, loggableId, name, activeTags, activeLabels, allLabels.length],
  )

  if (type === 'line') return <ComparisonLine runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'bar') return <ComparisonBar runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'histogram') return <ComparisonHistogram runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} />
  if (type === 'scatter') return <ComparisonScatter runIds={runIds} runColors={runColors} runNameFor={runNameFor} seriesFor={seriesFor} allLabels={allLabels} />
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
              stroke={runColors.get(rid) ?? DEFAULT_RUN_COLOR}
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
  // One chart per step: x = dict keys (categories), each run's column stacks
  // its values at that step. Entries are pre-grouped by step so the nested
  // loop below is O(runs × steps) rather than the O(runs × steps × entries)
  // a per-step `Array.find` walk would cost.
  const stepViews = useMemo(() => {
    type Grouped = Record<string, MetricEntry>
    const byRun: Record<string, Grouped> = {}
    const stepsSet = new Set<number>()
    for (const rid of runIds) {
      const series = seriesFor(rid)
      if (!series) continue
      const m: Grouped = {}
      for (const e of series.entries) {
        const step = e.step ?? 0
        stepsSet.add(step)
        m[step] = e
      }
      byRun[rid] = m
    }
    const steps = [...stepsSet].sort((a, b) => a - b)
    return steps.map(step => {
      const categories = new Set<string>()
      const perRun: Record<string, Record<string, number>> = {}
      for (const rid of runIds) {
        const e = byRun[rid]?.[step]
        if (!e) continue
        const v = e.value as Record<string, unknown> | undefined
        if (!v || typeof v !== 'object') continue
        perRun[rid] = {}
        for (const [k, vv] of Object.entries(v)) {
          categories.add(k)
          perRun[rid][k] = typeof vv === 'number' ? vv : Number(vv) || 0
        }
      }
      const data = [...categories].map(cat => {
        const row: Record<string, number | string> = { category: cat }
        for (const rid of runIds) row[rid] = perRun[rid]?.[cat] ?? 0
        return row
      })
      return { step, data }
    })
  }, [runIds, seriesFor])

  return (
    <div className="space-y-3">
      {stepViews.map(({ step, data }) => {
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
                    fill={runColors.get(rid) ?? DEFAULT_RUN_COLOR}
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
  type Slot = { rid: string; step: number; samples: number[] }
  const NUM = 30

  const { slots, data } = useMemo(() => {
    // Bin all samples across every run × every step against a shared range.
    const s: Slot[] = []
    for (const rid of runIds) {
      const series = seriesFor(rid)
      if (!series) continue
      for (const e of series.entries) {
        if (Array.isArray(e.value)) {
          s.push({ rid, step: e.step ?? 0, samples: e.value as number[] })
        }
      }
    }
    if (s.length === 0) return { slots: s, data: [] as Record<string, number>[] }
    // Fold-based min/max — avoids `Math.min(...arr)` stack overflow on large
    // sample pools and is O(N) with no intermediate allocation.
    let min = Infinity
    let max = -Infinity
    for (const slot of s) for (const v of slot.samples) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const size = (max - min) / NUM || 1
    // Pre-bin each slot once; avoids rescanning every slot per bin.
    const counts = s.map(slot => {
      const row = new Array<number>(NUM).fill(0)
      for (const v of slot.samples) {
        let idx = Math.floor((v - min) / size)
        if (idx < 0) idx = 0
        if (idx > NUM - 1) idx = NUM - 1
        row[idx]++
      }
      return row
    })
    const rows: Record<string, number>[] = []
    for (let i = 0; i < NUM; i++) {
      const row: Record<string, number> = { x: min + (i + 0.5) * size }
      s.forEach((slot, j) => {
        row[`${slot.rid}__${slot.step}__${j}`] = counts[j][i]
      })
      rows.push(row)
    }
    return { slots: s, data: rows }
  }, [runIds, seriesFor])

  if (slots.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No histogram samples to compare</p>
  }
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
          const color = runColors.get(slot.rid) ?? DEFAULT_RUN_COLOR
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

function ComparisonScatter({ runIds, runColors, runNameFor, seriesFor, allLabels }: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
  allLabels: string[]
}) {
  type Slot = { rid: string; step: number; label: string; data: { x: number; y: number }[] }
  const slots: Slot[] = []
  for (const rid of runIds) {
    const s = seriesFor(rid)
    if (!s) continue
    for (const e of s.entries) {
      const v = e.value as Record<string, { x?: unknown; y?: unknown }> | undefined
      if (!v || typeof v !== 'object') continue
      for (const [label, series] of Object.entries(v)) {
        if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
        const data = (series.x as number[]).map((x, i) => ({ x, y: (series.y as number[])[i] }))
        slots.push({ rid, step: e.step ?? 0, label, data })
      }
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
          const color = runColors.get(slot.rid) ?? DEFAULT_RUN_COLOR
          const shape = shapeForLabel(slot.label, allLabels)
          return (
            <Scatter
              key={`${slot.rid}-${slot.step}-${slot.label}-${i}`}
              name={`${runNameFor(slot.rid)} · ${slot.label} · step ${slot.step}`}
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
