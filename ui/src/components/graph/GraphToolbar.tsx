import { useState } from 'react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { GitFork, ArrowDownUp, ArrowLeftRight, Download } from 'lucide-react'
import { ExportOptionsModal } from '@/components/export/ExportOptionsModal'

interface GraphToolbarProps {
  onResetLayout: () => void
  runId: string
}

export function GraphToolbar({ onResetLayout, runId }: GraphToolbarProps) {
  const dagDirection = useStore(s => s.dagDirection)
  const toggleDagDirection = useStore(s => s.toggleDagDirection)
  const [exportOpen, setExportOpen] = useState(false)

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
          onClick={onResetLayout}
          title="Reset layout"
        >
          <GitFork className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card/80 backdrop-blur-sm"
          onClick={() => setExportOpen(true)}
          title="Export DAG"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ExportOptionsModal open={exportOpen} onClose={() => setExportOpen(false)} runId={runId} />
    </div>
  )
}
