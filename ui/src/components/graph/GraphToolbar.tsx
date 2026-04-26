import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Maximize, GitFork, ArrowDownUp, ArrowLeftRight, Pause, Play, Download } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { exportAsPng, exportAsJpg, exportAsPdf, exportAsSvg, exportAsDrawio } from '@/lib/export'

interface GraphToolbarProps {
  onResetLayout: () => void
  runId: string
}

export function GraphToolbar({ onResetLayout, runId }: GraphToolbarProps) {
  const { fitView, getNodes } = useReactFlow()
  const dagDirection = useStore(s => s.dagDirection)
  const toggleDagDirection = useStore(s => s.toggleDagDirection)
  const runState = useStore(s => s.runs.get(runId))
  const setPaused = useStore(s => s.setPaused)
  const graph = runState?.graph
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const hasPausable = runState?.graph?.has_pausable ?? false
  const isPaused = runState?.paused ?? false
  const isRunning = runState?.summary.status === 'running'

  const togglePause = useCallback(async () => {
    if (isPaused) {
      await api.unpauseRun(runId)
      setPaused(runId, false)
    } else {
      await api.pauseRun(runId)
      setPaused(runId, true)
    }
  }, [runId, isPaused, setPaused])

  // Captures the React Flow viewport including all visible nodes/edges. We
  // grab the inner pane (transformed content) rather than the outer frame so
  // the export doesn't include the toolbar overlays themselves.
  const viewportEl = useCallback((): HTMLElement | null => {
    return document.querySelector('.react-flow__viewport') as HTMLElement | null
  }, [])

  const runExport = useCallback(
    async (kind: 'png' | 'jpg' | 'pdf' | 'svg' | 'drawio') => {
      setExportOpen(false)
      setExporting(true)
      try {
        if (kind === 'drawio') {
          if (!graph) return
          const positions = new Map<string, { x: number; y: number; width: number; height: number }>()
          for (const n of getNodes()) {
            if (!graph.nodes[n.id]) continue
            positions.set(n.id, {
              x: n.position.x,
              y: n.position.y,
              width: n.measured?.width ?? 240,
              height: n.measured?.height ?? 100,
            })
          }
          exportAsDrawio(graph, positions)
          return
        }
        const el = viewportEl()
        if (!el) return
        if (kind === 'png') await exportAsPng(el)
        else if (kind === 'jpg') await exportAsJpg(el)
        else if (kind === 'pdf') await exportAsPdf(el)
        else if (kind === 'svg') await exportAsSvg(el)
      } finally {
        setExporting(false)
      }
    },
    [graph, getNodes, viewportEl],
  )

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1 z-10 items-end">
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card/80 backdrop-blur-sm"
          onClick={toggleDagDirection}
          title={dagDirection === 'TB' ? 'Switch to horizontal layout' : 'Switch to vertical layout'}
        >
          {dagDirection === 'TB' ? (
            <ArrowLeftRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownUp className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card/80 backdrop-blur-sm"
          onClick={() => fitView({ padding: 0.1, duration: 300 })}
          title="Fit to view"
        >
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card/80 backdrop-blur-sm"
          onClick={onResetLayout}
          title="Reset layout"
        >
          <GitFork className="h-3.5 w-3.5" />
        </Button>
        <Popover open={exportOpen} onOpenChange={setExportOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-card/80 backdrop-blur-sm"
              disabled={exporting}
              title="Export DAG"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <div className="flex flex-col">
              <button onClick={() => runExport('png')} className="text-xs text-left px-2 py-1.5 rounded hover:bg-muted">PNG</button>
              <button onClick={() => runExport('jpg')} className="text-xs text-left px-2 py-1.5 rounded hover:bg-muted">JPG</button>
              <button onClick={() => runExport('pdf')} className="text-xs text-left px-2 py-1.5 rounded hover:bg-muted">PDF</button>
              <button onClick={() => runExport('svg')} className="text-xs text-left px-2 py-1.5 rounded hover:bg-muted">SVG</button>
              <button onClick={() => runExport('drawio')} className="text-xs text-left px-2 py-1.5 rounded hover:bg-muted">.drawio</button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {hasPausable && isRunning && (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className={`h-8 backdrop-blur-sm ${isPaused ? 'bg-yellow-500/20 border-yellow-500/50 hover:bg-yellow-500/30' : 'bg-card/80'}`}
            onClick={togglePause}
            title={isPaused ? 'Resume execution' : 'Pause execution'}
          >
            {isPaused ? (
              <>
                <Play className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Resume</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Pause</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
