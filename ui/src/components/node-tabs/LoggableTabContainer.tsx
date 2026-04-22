import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore, type NodeTab } from '@/store'
import { cn } from '@/lib/utils'
import { Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoggableTabContent } from './LoggableTabContent'
import { useComparisonContext } from '@/hooks/useComparisonContext'

interface LoggableTabContainerProps {
  runId: string
  loggableId: string
}

const allTabs: { key: NodeTab; label: string; alwaysShow: boolean }[] = [
  { key: 'info', label: 'Info', alwaysShow: true },
  { key: 'logs', label: 'Logs', alwaysShow: false },
  { key: 'metrics', label: 'Metrics', alwaysShow: false },
  { key: 'images', label: 'Images', alwaysShow: false },
  { key: 'audio', label: 'Audio', alwaysShow: false },
  { key: 'ask', label: 'Ask', alwaysShow: false },
]

const VALID_TABS: readonly NodeTab[] = ['info', 'logs', 'metrics', 'images', 'audio', 'ask']

export function LoggableTabContainer({ runId, loggableId }: LoggableTabContainerProps) {
  const pinTab = useStore(s => s.pinTab)
  const run = useStore(s => s.runs.get(runId))
  const runs = useStore(s => s.runs)
  const { isComparison, runIds: comparisonRunIds } = useComparisonContext()

  // Nodes can declare `ui={"default_tab": "metrics"}` on @nb.fn to open a
  // specific tab when the card is first expanded. User clicks override.
  const defaultTab = useMemo<NodeTab>(() => {
    const hint = run?.graph?.nodes?.[loggableId]?.ui_hints?.default_tab
    return typeof hint === 'string' && (VALID_TABS as readonly string[]).includes(hint)
      ? (hint as NodeTab)
      : 'info'
  }, [run?.graph?.nodes, loggableId])

  const userChoseTab = useRef(false)
  const [activeTab, setActiveTab] = useState<NodeTab>(defaultTab)

  useEffect(() => {
    if (!userChoseTab.current) setActiveTab(defaultTab)
  }, [defaultTab])

  const hasPendingAsk = useMemo(() => {
    const asks = run?.pendingAsks
    if (!asks || asks.size === 0) return false
    for (const a of asks.values()) { if (a.nodeName === loggableId) return true }
    return false
  }, [run?.pendingAsks, loggableId])

  // In comparison mode, aggregate data availability across all runs
  const hasLogs = useMemo(() => {
    if (isComparison) {
      return comparisonRunIds.some(rid => {
        const r = runs.get(rid)
        if (!r) return false
        const logsHit = r.logs?.some(l => l.node === loggableId) ?? false
        const errHit = r.errors?.some(e => e.node_name === loggableId) ?? false
        return logsHit || errHit
      })
    }
    if (!run) return false
    const logsHit = run.logs?.some(l => l.node === loggableId) ?? false
    const errHit = run.errors?.some(e => e.node_name === loggableId) ?? false
    return logsHit || errHit
  }, [isComparison, comparisonRunIds, runs, run, loggableId])

  const hasMetrics = useMemo(() => {
    if (isComparison) {
      return comparisonRunIds.some(rid => {
        const r = runs.get(rid)
        return !!r?.loggableMetrics?.[loggableId] && Object.keys(r.loggableMetrics[loggableId]).length > 0
      })
    }
    return !!run?.loggableMetrics?.[loggableId] && Object.keys(run.loggableMetrics[loggableId]).length > 0
  }, [isComparison, comparisonRunIds, runs, run, loggableId])

  const hasImages = useMemo(() => {
    if (isComparison) {
      return comparisonRunIds.some(rid => (runs.get(rid)?.loggableImages?.[loggableId]?.length ?? 0) > 0)
    }
    return (run?.loggableImages?.[loggableId]?.length ?? 0) > 0
  }, [isComparison, comparisonRunIds, runs, run, loggableId])

  const hasAudio = useMemo(() => {
    if (isComparison) {
      return comparisonRunIds.some(rid => (runs.get(rid)?.loggableAudio?.[loggableId]?.length ?? 0) > 0)
    }
    return (run?.loggableAudio?.[loggableId]?.length ?? 0) > 0
  }, [isComparison, comparisonRunIds, runs, run, loggableId])

  const visibleTabs = useMemo(() => {
    return allTabs.filter(tab => {
      if (tab.alwaysShow) return true
      switch (tab.key) {
        case 'logs': return hasLogs
        case 'metrics': return hasMetrics
        case 'images': return hasImages
        case 'audio': return hasAudio
        case 'ask': return hasPendingAsk
        default: return false
      }
    })
  }, [hasLogs, hasMetrics, hasImages, hasAudio, hasPendingAsk])

  // Only reset to the default if the user hasn't explicitly chosen a tab.
  // Once the user clicks a tab, keep it even if it temporarily leaves
  // visibleTabs (e.g., while data is still loading via WebSocket).
  const isActiveVisible = visibleTabs.some(t => t.key === activeTab)
  const resolvedTab = isActiveVisible ? activeTab : (userChoseTab.current ? activeTab : defaultTab)

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center border-b border-border">
        <div className="flex flex-1">
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors relative',
                resolvedTab === tab.key
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={(e) => {
                e.stopPropagation()
                userChoseTab.current = true
                setActiveTab(tab.key)
              }}
            >
              {tab.label}
              {tab.key === 'ask' && hasPendingAsk && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 mr-1"
          onClick={(e) => {
            e.stopPropagation()
            pinTab(runId, loggableId, resolvedTab)
          }}
          title="Pin this tab"
        >
          <Pin className="h-3 w-3" />
        </Button>
      </div>

      {/* Tab content */}
      <div className="p-3 max-h-[420px] overflow-auto" onClick={e => e.stopPropagation()}>
        <LoggableTabContent runId={runId} loggableId={loggableId} tab={resolvedTab} comparisonRunIds={isComparison ? comparisonRunIds : undefined} />
      </div>
    </div>
  )
}
