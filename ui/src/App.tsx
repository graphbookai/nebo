import { useWebSocket } from '@/hooks/useWebSocket'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useStore } from '@/store'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { RunDetailView } from '@/components/layout/RunDetailView'
import { RightPanel } from '@/components/layout/RightPanel'
import { RunList } from '@/components/runs/RunList'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEmbeddedView } from '@/hooks/useEmbeddedView'
import { EmbeddedView } from '@/components/embedded/EmbeddedView'

export default function App() {
  useWebSocket()
  const isDesktop = useIsDesktop()
  const selectedRunId = useStore(s => s.selectedRunId)
  const reconnecting = useStore(s => s.reconnecting)
  const connected = useStore(s => s.connected)
  const rightPanelOpen = useStore(s => s.rightPanelOpen)
  const embedded = useEmbeddedView()

  if (embedded) {
    return (
      <TooltipProvider delayDuration={200}>
        <ErrorBoundary label="EmbeddedView">
          <EmbeddedView spec={embedded} />
        </ErrorBoundary>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Reconnection banner */}
      {!connected && reconnecting && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-1.5 text-xs text-yellow-500 text-center shrink-0">
          Reconnecting to daemon...
        </div>
      )}
      {!connected && !reconnecting && (
        <div className="bg-muted border-b border-border px-4 py-1.5 text-xs text-muted-foreground text-center shrink-0">
          Not connected to daemon. Start one with <code className="bg-background px-1 py-0.5 rounded">nebo serve</code>
        </div>
      )}

      {isDesktop ? (
        /* Desktop: sidebar + detail + right panel */
        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 shrink-0 overflow-hidden">
            <ErrorBoundary label="Sidebar">
              <Sidebar />
            </ErrorBoundary>
          </div>
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary label="RunDetailView">
              <RunDetailView />
            </ErrorBoundary>
          </div>
          {selectedRunId && rightPanelOpen && (
            <div className="w-80 shrink-0 overflow-hidden">
              <ErrorBoundary label="RightPanel">
                <RightPanel runId={selectedRunId} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      ) : (
        /* Mobile: full-screen switching */
        <>
          <MobileNav />
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary label="MainContent">
              {selectedRunId ? (
                <RunDetailView />
              ) : (
                <RunList />
              )}
            </ErrorBoundary>
          </div>
        </>
      )}
    </div>
    </TooltipProvider>
  )
}
