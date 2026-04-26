import { memo, useMemo, useState } from 'react'
import { useStore, type ImageEntry, type AudioEntry } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfigChips } from '@/components/shared/ConfigChips'
import { cn } from '@/lib/utils'
import { Search, Maximize2, Minimize2 } from 'lucide-react'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { MetricBlock } from '@/components/node-tabs/NodeMetrics'
import { ImageItem } from '@/components/node-tabs/NodeImages'
import { AudioItem } from '@/components/node-tabs/NodeAudio'
import { NodeLogs } from '@/components/node-tabs/NodeLogs'
import { useLoggableHasContent } from '@/hooks/useLoggableHasContent'
import { topologicalSort } from '@/lib/graph'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { LoggableMetricSeries } from '@/lib/api'

interface LoggableGridViewProps {
  runId: string
}

interface CardShellProps {
  title: string
  subtitle?: React.ReactNode
  isMaximized: boolean
  onToggleMaximize: () => void
  borderClass?: string
  children: React.ReactNode
}

const CardShell = memo(function CardShell({
  title,
  subtitle,
  isMaximized,
  onToggleMaximize,
  borderClass,
  children,
}: CardShellProps) {
  // Treat `null`/`false` as "no body" so the header doesn't carry a dangling
  // bottom border with empty padding below it.
  const hasBody = !(children === null || children === false || children === undefined)
  return (
    <div
      className={cn(
        'border-2 rounded-lg flex flex-col min-w-0',
        borderClass ?? 'border-border',
        isMaximized && 'col-span-full',
      )}
    >
      <div
        className={cn(
          'flex items-start gap-2 px-3 py-2.5',
          hasBody && 'border-b border-border',
        )}
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block">{title}</span>
          {subtitle}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize row'}
        >
          {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {hasBody && <div className="p-3 min-w-0">{children}</div>}
    </div>
  )
})

function FunctionCard({
  runId,
  loggableId,
  isMaximized,
  onToggleMaximize,
  isDag,
}: {
  runId: string
  loggableId: string
  isMaximized: boolean
  onToggleMaximize: () => void
  isDag: boolean
}) {
  const node = useStore(s => s.runs.get(runId)?.graph?.nodes[loggableId])
  const hasErrors = useStore(s => (s.runs.get(runId)?.errors ?? []).some(e => e.node_name === loggableId))
  const isRunning = useStore(s => s.runs.get(runId)?.summary.status === 'running') && (node?.exec_count ?? 0) > 0
  const hasContent = useLoggableHasContent(runId, loggableId)

  if (!node) return null

  const borderClass = hasErrors
    ? 'border-red-500'
    : isRunning
    ? 'border-blue-500'
    : !isDag
    ? 'border-dashed border-muted-foreground/40'
    : 'border-border'

  const subtitle = (
    <>
      {node.docstring && (
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 cursor-help">
              {node.docstring.split('\n')[0]}
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" align="start">
            {node.docstring}
          </TooltipContent>
        </Tooltip>
      )}
      <ConfigChips params={node.params} />
      {node.exec_count > 0 && (
        <span className="text-[10px] text-muted-foreground mt-1 inline-block">
          x{node.exec_count.toLocaleString()}
        </span>
      )}
    </>
  )

  return (
    <CardShell
      title={node.func_name}
      subtitle={subtitle}
      isMaximized={isMaximized}
      onToggleMaximize={onToggleMaximize}
      borderClass={borderClass}
    >
      {hasContent ? <LoggableTabContainer runId={runId} loggableId={loggableId} /> : null}
    </CardShell>
  )
}

function GlobalLogsCard({
  runId,
  isMaximized,
  onToggleMaximize,
}: {
  runId: string
  isMaximized: boolean
  onToggleMaximize: () => void
}) {
  return (
    <CardShell title="Logs" isMaximized={isMaximized} onToggleMaximize={onToggleMaximize}>
      <NodeLogs runId={runId} loggableId="__global__" />
    </CardShell>
  )
}

function GlobalMetricCard({
  runId,
  name,
  series,
  isMaximized,
  onToggleMaximize,
}: {
  runId: string
  name: string
  series: LoggableMetricSeries
  isMaximized: boolean
  onToggleMaximize: () => void
}) {
  const runColor = useStore(s => s.runColors.get(runId)) ?? DEFAULT_RUN_COLOR
  return (
    <CardShell title={name} isMaximized={isMaximized} onToggleMaximize={onToggleMaximize}>
      <MetricBlock name={name} series={series} color={runColor} />
    </CardShell>
  )
}

function GlobalImageCard({
  runId,
  name,
  entries,
  isMaximized,
  onToggleMaximize,
}: {
  runId: string
  name: string
  entries: ImageEntry[]
  isMaximized: boolean
  onToggleMaximize: () => void
}) {
  return (
    <CardShell title={name} isMaximized={isMaximized} onToggleMaximize={onToggleMaximize}>
      <div className="space-y-3">
        {entries.map(img => (
          <ImageItem key={img.mediaId} runId={runId} loggableId="__global__" img={img} showTimestamp />
        ))}
      </div>
    </CardShell>
  )
}

function GlobalAudioCard({
  runId,
  name,
  entries,
  isMaximized,
  onToggleMaximize,
}: {
  runId: string
  name: string
  entries: AudioEntry[]
  isMaximized: boolean
  onToggleMaximize: () => void
}) {
  return (
    <CardShell title={name} isMaximized={isMaximized} onToggleMaximize={onToggleMaximize}>
      <div className="space-y-3">
        {entries.map(entry => (
          <AudioItem key={entry.mediaId} runId={runId} entry={entry} showTimestamp />
        ))}
      </div>
    </CardShell>
  )
}

interface GlobalCardSpec {
  cardId: string
  title: string
  render: (isMaximized: boolean, onToggleMaximize: () => void) => React.ReactNode
}

// Module-level empty fallbacks — sharing references prevents zustand from
// thinking each render produced a new value (which would re-fire the
// subscription and infinite-loop).
const EMPTY_METRICS: Record<string, LoggableMetricSeries> = {}
const EMPTY_IMAGES: ImageEntry[] = []
const EMPTY_AUDIO: AudioEntry[] = []
const EMPTY_LOGS: import('@/lib/api').LogEntry[] = []

export function LoggableGridView({ runId }: LoggableGridViewProps) {
  const graph = useStore(s => s.runs.get(runId)?.graph)
  const globalLoggable = useStore(s => s.runs.get(runId)?.globalLoggable)
  const hideUncalled = useStore(s => s.settings.hideUncalledFunctions)
  // Subscribe to RAW values only — derived/filtered shapes go through
  // useMemo below so the selector always returns a stable reference and
  // doesn't trigger an update loop.
  const allLogsRaw = useStore(s => s.runs.get(runId)?.logs)
  const globalMetricsRaw = useStore(s => s.runs.get(runId)?.loggableMetrics?.['__global__'])
  const globalImagesRaw = useStore(s => s.runs.get(runId)?.loggableImages?.['__global__'])
  const globalAudioRaw = useStore(s => s.runs.get(runId)?.loggableAudio?.['__global__'])
  const allLogs = allLogsRaw ?? EMPTY_LOGS
  const globalMetrics = globalMetricsRaw ?? EMPTY_METRICS
  const globalImages = globalImagesRaw ?? EMPTY_IMAGES
  const globalAudio = globalAudioRaw ?? EMPTY_AUDIO
  const globalLogs = useMemo(
    () => allLogs.filter(l => l.node === '__global__'),
    [allLogs],
  )

  const [search, setSearch] = useState('')
  const [maximized, setMaximized] = useState<Set<string>>(() => new Set())
  const toggleMaximized = (cardId: string) => {
    setMaximized(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const allNodeIds = useMemo(() => graph
    ? Object.keys(graph.nodes).filter(id => !hideUncalled || graph.nodes[id].exec_count > 0)
    : [], [graph, hideUncalled])

  const globalCards = useMemo<GlobalCardSpec[]>(() => {
    // Show the Global section whenever global-scoped data exists, even if the
    // run finished before the WS `loggable_register` event for `__global__`
    // arrived (REST-loaded historical runs go straight to data).
    const hasAnyGlobalData =
      !!globalLoggable
      || globalLogs.length > 0
      || Object.keys(globalMetrics).length > 0
      || globalImages.length > 0
      || globalAudio.length > 0
    if (!hasAnyGlobalData) return []
    const cards: GlobalCardSpec[] = []
    if (globalLogs.length > 0) {
      cards.push({
        cardId: 'global:logs',
        title: 'Logs',
        render: (isMax, toggle) => <GlobalLogsCard runId={runId} isMaximized={isMax} onToggleMaximize={toggle} />,
      })
    }
    for (const [name, series] of Object.entries(globalMetrics)) {
      cards.push({
        cardId: `global:metric:${name}`,
        title: name,
        render: (isMax, toggle) => (
          <GlobalMetricCard runId={runId} name={name} series={series} isMaximized={isMax} onToggleMaximize={toggle} />
        ),
      })
    }
    const imagesByName = new Map<string, ImageEntry[]>()
    for (const img of globalImages) {
      const arr = imagesByName.get(img.name) ?? []
      arr.push(img)
      imagesByName.set(img.name, arr)
    }
    for (const [name, entries] of imagesByName) {
      cards.push({
        cardId: `global:image:${name}`,
        title: name,
        render: (isMax, toggle) => (
          <GlobalImageCard runId={runId} name={name} entries={entries} isMaximized={isMax} onToggleMaximize={toggle} />
        ),
      })
    }
    const audioByName = new Map<string, AudioEntry[]>()
    for (const a of globalAudio) {
      const arr = audioByName.get(a.name) ?? []
      arr.push(a)
      audioByName.set(a.name, arr)
    }
    for (const [name, entries] of audioByName) {
      cards.push({
        cardId: `global:audio:${name}`,
        title: name,
        render: (isMax, toggle) => (
          <GlobalAudioCard runId={runId} name={name} entries={entries} isMaximized={isMax} onToggleMaximize={toggle} />
        ),
      })
    }
    return cards
  }, [runId, globalLoggable, globalLogs, globalMetrics, globalImages, globalAudio])

  const sortedFunctionIds = useMemo(() => {
    if (!graph) return [] as string[]
    return topologicalSort(allNodeIds, graph.edges)
  }, [graph, allNodeIds])

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    )
  }

  // Filter by title (case-insensitive substring). Function cards match against
  // the function name; global cards against their title.
  const q = search.trim().toLowerCase()
  const filterTitle = (t: string) => q === '' || t.toLowerCase().includes(q)

  const visibleGlobalCards = globalCards.filter(c => filterTitle(c.title))
  const visibleFunctionIds = sortedFunctionIds.filter(id => {
    const fn = graph.nodes[id]?.func_name ?? id
    return filterTitle(fn)
  })

  return (
    <ScrollArea className="h-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-3 py-2">
        <div className="flex items-center gap-1 bg-muted rounded-md px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Filter cards..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-xs py-1.5 w-full"
          />
        </div>
      </div>

      {visibleGlobalCards.length > 0 && (
        <section className="px-3 pt-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Global</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleGlobalCards.map(c => (
              <div key={c.cardId} className={cn(maximized.has(c.cardId) && 'col-span-full')}>
                {c.render(maximized.has(c.cardId), () => toggleMaximized(c.cardId))}
              </div>
            ))}
          </div>
        </section>
      )}

      {visibleFunctionIds.length > 0 && (
        <section className="px-3 py-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Functions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleFunctionIds.map(id => {
              const cardId = `fn:${id}`
              const targetSet = new Set(graph.edges.map(e => e.target))
              const sourceSet = new Set(graph.edges.map(e => e.source))
              const isDag = sourceSet.has(id) || targetSet.has(id) || graph.nodes[id].is_source
              return (
                <div key={cardId} className={cn(maximized.has(cardId) && 'col-span-full')}>
                  <FunctionCard
                    runId={runId}
                    loggableId={id}
                    isMaximized={maximized.has(cardId)}
                    onToggleMaximize={() => toggleMaximized(cardId)}
                    isDag={isDag}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {visibleGlobalCards.length === 0 && visibleFunctionIds.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <p className="text-sm">{q ? 'No cards match the filter' : 'No data yet'}</p>
        </div>
      )}
    </ScrollArea>
  )
}
