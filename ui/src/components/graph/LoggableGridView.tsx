import { memo, useMemo, useState } from 'react'
import { useStore, type ImageEntry, type AudioEntry } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import { Search, Maximize2 } from 'lucide-react'
import { MetricBlock } from '@/components/node-tabs/NodeMetrics'
import { VirtualizedImageList } from '@/components/node-tabs/NodeImages'
import { AudioItem } from '@/components/node-tabs/NodeAudio'
import { NodeLogs } from '@/components/node-tabs/NodeLogs'
import { topologicalSort } from '@/lib/graph'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import { useTimelineFilter } from '@/hooks/useTimelineFilter'
import type { LoggableMetricSeries } from '@/lib/api'

interface LoggableGridViewProps {
  runId: string
}

// ─── Card chrome ─────────────────────────────────────────────────────────────

interface CardShellProps {
  title: string
  onMaximize: () => void
  children: React.ReactNode
}

// Cards in the grid lock to a uniform height so the tile field stays
// even regardless of how much data each loggable carries. Bodies that
// can outgrow this height (long log feeds, dense metric histories,
// stacks of images/audio) scroll inside the card; the modal expand
// gives the user a larger viewport when they need it.
const CARD_HEIGHT_PX = 360
const CARD_HEADER_PX = 36              // matches `px-3 py-2` + text-sm line height
const CARD_BODY_PADDING_PX = 12 * 2    // p-3 top + bottom
// What the inner content can occupy after chrome. Used by content
// components that need an explicit pixel cap (e.g., VirtualizedImageList).
const CARD_INNER_HEIGHT_PX = CARD_HEIGHT_PX - CARD_HEADER_PX - CARD_BODY_PADDING_PX

const CardShell = memo(function CardShell({ title, onMaximize, children }: CardShellProps) {
  return (
    <div
      className="border-2 border-border rounded-lg flex flex-col min-w-0"
      style={{ height: CARD_HEIGHT_PX }}
    >
      <div className="flex items-start gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onMaximize}
          title="Open in modal"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="p-3 min-w-0 flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
})

// ─── Per-loggable card bodies (used by both Global and per-function rows) ────

function LogsCardBody({ runId, loggableId }: { runId: string; loggableId: string }) {
  return <NodeLogs runId={runId} loggableId={loggableId} />
}

// "No entries in current range" shown when the timeline scrubber excludes
// every entry in this card. The card stays visible so the user can widen
// the scrubber without losing track of which loggables actually exist.
function EmptyForRange() {
  return (
    <p className="text-xs text-muted-foreground">No entries in current range</p>
  )
}

function MetricCardBody({
  runId,
  name,
  series,
  inModal,
}: {
  runId: string
  name: string
  series: LoggableMetricSeries
  inModal: boolean
}) {
  const runColor = useStore(s => s.runColors.get(runId)) ?? DEFAULT_RUN_COLOR
  // The step scrubber doesn't filter metric entries here. Line/scatter
  // are accumulating and their renderers mark the active step inline
  // (vertical guideline / dimmed non-matching points); bar/pie/histogram
  // are stepless snapshots. Filtering would only ever hide context.
  if (series.entries.length === 0) return <EmptyForRange />

  // `MetricBlock fill` resolves the chart height against its parent's
  // height. The grid card pins that to CARD_HEIGHT_PX, so it works
  // there. The Modal body is `flex-1 min-h-0` inside `max-h-[90vh]`,
  // so without an explicit height the chart collapses to 0px. Wrap
  // the modal version in a definite-height container so `h-full`
  // chart sizing has something to grow into.
  if (inModal) {
    return (
      <div className="h-[60vh] flex flex-col min-h-0">
        <MetricBlock name={name} series={series} color={runColor} fill />
      </div>
    )
  }
  return <MetricBlock name={name} series={series} color={runColor} fill />
}

function ImageCardBody({
  runId,
  loggableId,
  entries,
  inModal,
}: {
  runId: string
  loggableId: string
  entries: ImageEntry[]
  inModal: boolean
}) {
  const timelineFilter = useTimelineFilter()
  const visible = useMemo(() => {
    if (!timelineFilter) return entries
    return entries.filter(e => timelineFilter.matchEntry(e))
  }, [entries, timelineFilter])
  if (visible.length === 0) return <EmptyForRange />
  return (
    <VirtualizedImageList
      runId={runId}
      loggableId={loggableId}
      images={visible}
      showTimestamp
      maxHeight={inModal ? 720 : CARD_INNER_HEIGHT_PX}
    />
  )
}

function AudioCardBody({ runId, entries }: { runId: string; entries: AudioEntry[] }) {
  const timelineFilter = useTimelineFilter()
  const visible = useMemo(() => {
    if (!timelineFilter) return entries
    return entries.filter(e => timelineFilter.matchEntry(e))
  }, [entries, timelineFilter])
  if (visible.length === 0) return <EmptyForRange />
  return (
    <div className="space-y-3">
      {visible.map(entry => (
        <AudioItem key={entry.mediaId} runId={runId} entry={entry} showTimestamp />
      ))}
    </div>
  )
}

// ─── Tab + section model ────────────────────────────────────────────────────

type TabKey = 'logs' | 'metrics' | 'images' | 'audio'

interface CardSpec {
  cardId: string                       // unique per (section, tab, name)
  title: string                        // "Section > Item" displayed in card header
  render: (inModal: boolean) => React.ReactNode
}

interface SectionSpec {
  /** Stable key — `__global__` or the loggable's id for function nodes. */
  sectionId: string
  /** Display name shown above the card grid; clickable to filter. */
  label: string
  cards: CardSpec[]
}

// Module-level fallbacks. zustand re-renders when a selector returns a
// fresh reference, so we share these to keep the rest of the component
// memo-stable when the underlying slice is undefined.
const EMPTY_METRICS: Record<string, LoggableMetricSeries> = {}
const EMPTY_IMAGES: ImageEntry[] = []
const EMPTY_AUDIO: AudioEntry[] = []
const EMPTY_LOGS: import('@/lib/api').LogEntry[] = []
const EMPTY_LOGGABLE_IMAGES: Record<string, ImageEntry[]> = {}
const EMPTY_LOGGABLE_AUDIO: Record<string, AudioEntry[]> = {}
const EMPTY_LOGGABLE_METRICS: Record<string, Record<string, LoggableMetricSeries>> = {}

// ─── Main view ───────────────────────────────────────────────────────────────

export function LoggableGridView({ runId }: LoggableGridViewProps) {
  const graph = useStore(s => s.runs.get(runId)?.graph)
  const hideUncalled = useStore(s => s.settings.hideUncalledFunctions)

  // Subscribe to raw slices only; derive groupings via useMemo.
  const allLogsRaw = useStore(s => s.runs.get(runId)?.logs)
  const allMetricsRaw = useStore(s => s.runs.get(runId)?.loggableMetrics)
  const allImagesRaw = useStore(s => s.runs.get(runId)?.loggableImages)
  const allAudioRaw = useStore(s => s.runs.get(runId)?.loggableAudio)
  const allLogs = allLogsRaw ?? EMPTY_LOGS
  const allMetrics = allMetricsRaw ?? EMPTY_LOGGABLE_METRICS
  const allImages = allImagesRaw ?? EMPTY_LOGGABLE_IMAGES
  const allAudio = allAudioRaw ?? EMPTY_LOGGABLE_AUDIO

  const [activeTab, setActiveTab] = useState<TabKey>('metrics')
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalCardId, setModalCardId] = useState<string | null>(null)

  // Section list: Global first, then function nodes in topo order.
  const sectionDescriptors = useMemo(() => {
    if (!graph) return [] as { sectionId: string; label: string }[]
    const fnIds = Object.keys(graph.nodes).filter(
      id => !hideUncalled || graph.nodes[id].exec_count > 0,
    )
    const sortedFnIds = topologicalSort(fnIds, graph.edges)
    const sections: { sectionId: string; label: string }[] = [
      { sectionId: '__global__', label: 'Global' },
    ]
    for (const id of sortedFnIds) {
      sections.push({
        sectionId: id,
        label: graph.nodes[id]?.func_name ?? id,
      })
    }
    return sections
  }, [graph, hideUncalled])

  // Helper: logs are a flat array on the run, indexed by node — so for
  // every section we filter once. Could be made a Map for O(N) instead
  // of O(N×sections), but section counts stay small in practice.
  const logsBySection = useMemo(() => {
    const m = new Map<string, typeof allLogs>()
    for (const s of sectionDescriptors) {
      m.set(s.sectionId, allLogs.filter(l => l.node === s.sectionId))
    }
    return m
  }, [allLogs, sectionDescriptors])

  // Build the four tabs' section specs. Each tab decides what counts as
  // a "card" for a given loggable.
  const tabs = useMemo<Record<TabKey, SectionSpec[]>>(() => {
    const logs: SectionSpec[] = []
    const metrics: SectionSpec[] = []
    const images: SectionSpec[] = []
    const audio: SectionSpec[] = []

    for (const { sectionId, label } of sectionDescriptors) {
      // Logs — one card per loggable that has any.
      const logEntries = logsBySection.get(sectionId) ?? []
      if (logEntries.length > 0) {
        logs.push({
          sectionId,
          label,
          cards: [
            {
              cardId: `logs:${sectionId}`,
              title: `${label} > Logs`,
              render: () => <LogsCardBody runId={runId} loggableId={sectionId} />,
            },
          ],
        })
      }

      // Metrics — one card per metric name on this loggable.
      const loggableMetrics = allMetrics[sectionId] ?? EMPTY_METRICS
      const metricEntries = Object.entries(loggableMetrics)
      if (metricEntries.length > 0) {
        metrics.push({
          sectionId,
          label,
          cards: metricEntries.map(([name, series]) => ({
            cardId: `metric:${sectionId}:${name}`,
            title: `${label} > ${name}`,
            render: (inModal) => (
              <MetricCardBody runId={runId} name={name} series={series} inModal={inModal} />
            ),
          })),
        })
      }

      // Images — group by image name so cards line up with how users
      // named their `nb.log_image(name=...)` calls.
      const loggableImages = allImages[sectionId] ?? EMPTY_IMAGES
      if (loggableImages.length > 0) {
        const byName = new Map<string, ImageEntry[]>()
        for (const img of loggableImages) {
          const arr = byName.get(img.name) ?? []
          arr.push(img)
          byName.set(img.name, arr)
        }
        images.push({
          sectionId,
          label,
          cards: [...byName.entries()].map(([name, entries]) => ({
            cardId: `image:${sectionId}:${name}`,
            title: `${label} > ${name}`,
            render: (inModal) => (
              <ImageCardBody
                runId={runId}
                loggableId={sectionId}
                entries={entries}
                inModal={inModal}
              />
            ),
          })),
        })
      }

      // Audio — same shape as images.
      const loggableAudio = allAudio[sectionId] ?? EMPTY_AUDIO
      if (loggableAudio.length > 0) {
        const byName = new Map<string, AudioEntry[]>()
        for (const a of loggableAudio) {
          const arr = byName.get(a.name) ?? []
          arr.push(a)
          byName.set(a.name, arr)
        }
        audio.push({
          sectionId,
          label,
          cards: [...byName.entries()].map(([name, entries]) => ({
            cardId: `audio:${sectionId}:${name}`,
            title: `${label} > ${name}`,
            render: () => <AudioCardBody runId={runId} entries={entries} />,
          })),
        })
      }
    }

    return { logs, metrics, images, audio }
  }, [runId, sectionDescriptors, logsBySection, allMetrics, allImages, allAudio])

  // Only show tab buttons that have at least one card on this run.
  const visibleTabs = useMemo(() => {
    const order: { key: TabKey; label: string }[] = [
      { key: 'logs', label: 'Logs' },
      { key: 'metrics', label: 'Metrics' },
      { key: 'images', label: 'Images' },
      { key: 'audio', label: 'Audio' },
    ]
    return order.filter(t => tabs[t.key].length > 0)
  }, [tabs])

  // Snap activeTab onto a visible tab whenever the current one disappears
  // (e.g., logs cleared, no more cards in the active tab). Pure derivation —
  // no useEffect needed because we only render against `effectiveTab`.
  const effectiveTab: TabKey =
    visibleTabs.find(t => t.key === activeTab)?.key ?? visibleTabs[0]?.key ?? 'logs'

  // Section filter: a chip row above the grid narrows the flat card
  // list to one loggable. Dropping a section that no longer carries
  // any cards clears the filter so the user doesn't end up with an
  // empty pane.
  const sectionsForTab = tabs[effectiveTab]
  const sectionChips = useMemo(
    () => sectionsForTab.map(s => ({ sectionId: s.sectionId, label: s.label })),
    [sectionsForTab],
  )
  const flatCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matchesQuery = (title: string) => q === '' || title.toLowerCase().includes(q)
    const out: CardSpec[] = []
    for (const section of sectionsForTab) {
      if (activeSectionId && section.sectionId !== activeSectionId) continue
      for (const card of section.cards) {
        if (matchesQuery(card.title)) out.push(card)
      }
    }
    return out
  }, [sectionsForTab, activeSectionId, search])

  // Resolve modal: walk every tab so the user can open a modal and then
  // switch tabs without the modal closing or pointing at stale data.
  const modalCard = useMemo(() => {
    if (!modalCardId) return null
    for (const list of Object.values(tabs)) {
      for (const section of list) {
        const c = section.cards.find(c => c.cardId === modalCardId)
        if (c) return c
      }
    }
    return null
  }, [modalCardId, tabs])

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    )
  }

  if (visibleTabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No data yet</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Top-level category tabs */}
        <div className="flex items-center px-3 pt-2 gap-1">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key)
                // Switching tabs clears any prior section focus so the
                // user starts from the full overview.
                setActiveSectionId(null)
              }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                effectiveTab === t.key
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground',
              )}
            >
              {t.label}
              <span className="ml-1.5 text-[10px] text-muted-foreground/80">
                {tabs[t.key].reduce((acc, s) => acc + s.cards.length, 0)}
              </span>
            </button>
          ))}
        </div>

        {/* Search + section chips. The chip row replaces the old
            per-section banners — cards live in one flat grid below
            and the user narrows by clicking a chip. */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1 flex-1 bg-muted rounded-md px-2">
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
        {sectionChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
            <button
              onClick={() => setActiveSectionId(null)}
              className={cn(
                'text-[10px] rounded px-2 py-0.5 border transition-colors',
                activeSectionId === null
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted',
              )}
            >
              All
            </button>
            {sectionChips.map(chip => {
              const active = activeSectionId === chip.sectionId
              return (
                <button
                  key={chip.sectionId}
                  onClick={() => setActiveSectionId(active ? null : chip.sectionId)}
                  className={cn(
                    'text-[10px] rounded px-2 py-0.5 border transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground border-accent'
                      : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted',
                  )}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        {flatCards.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">{search ? 'No cards match the filter' : 'No cards in this view'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {flatCards.map(card => (
              <div key={card.cardId}>
                <CardShell title={card.title} onMaximize={() => setModalCardId(card.cardId)}>
                  {card.render(false)}
                </CardShell>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalCard !== null}
        onClose={() => setModalCardId(null)}
        title={modalCard?.title}
        widthClass="max-w-6xl"
      >
        {modalCard?.render(true)}
      </Modal>
    </ScrollArea>
  )
}
