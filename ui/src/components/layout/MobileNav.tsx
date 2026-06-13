import { useStore } from '@/store'
import { SettingsPanel } from './SettingsPanel'
import { ArrowLeft, Link2, Link2Off } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { RunIdChip } from './RunDetailView'

function ConnectionIndicator({ connected }: { connected: boolean }) {
  return connected ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link2 className="h-4 w-4 text-green-500" />
      </TooltipTrigger>
      <TooltipContent align="start">Connected</TooltipContent>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link2Off className="h-4 w-4 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent align="start">Disconnected</TooltipContent>
    </Tooltip>
  )
}

export function MobileNav() {
  const selectedRunId = useStore(s => s.selectedRunId)
  const runs = useStore(s => s.runs)
  const selectRun = useStore(s => s.selectRun)
  const connected = useStore(s => s.connected)
  const viewMode = useStore(s => s.viewMode)
  const setViewMode = useStore(s => s.setViewMode)

  const run = selectedRunId ? runs.get(selectedRunId) : null

  if (run) {
    const scriptName = run.summary.script_path.split('/').pop() ?? run.summary.script_path

    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
        <Button variant="ghost" size="icon" onClick={() => selectRun(null)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium truncate">{scriptName}</span>
            <RunIdChip runId={run.summary.id} />
          </div>
        </div>
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as 'graph' | 'flat')}
        >
          <TabsList className="h-6">
            <TabsTrigger value="graph" className="text-xs h-5 px-2">DAG</TabsTrigger>
            <TabsTrigger value="flat" className="text-xs h-5 px-2">Flat</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <ConnectionIndicator connected={connected} />
          <SettingsPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
      <h1 className="text-lg font-semibold">Nebo</h1>
      <div className="flex items-center gap-1">
        <ConnectionIndicator connected={connected} />
        <SettingsPanel />
      </div>
    </div>
  )
}
