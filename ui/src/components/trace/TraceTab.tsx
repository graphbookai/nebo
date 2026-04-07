import { memo, useMemo, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'

interface TraceEvent {
  type: 'log' | 'error'
  node: string | null
  message: string
  timestamp: number
}

export const TraceTab = memo(function TraceTab({ runId }: { runId: string }) {
  const logs = useStore(s => s.runs.get(runId)?.logs ?? [])
  const errors = useStore(s => s.runs.get(runId)?.errors ?? [])
  const bottomRef = useRef<HTMLDivElement>(null)

  const events = useMemo(() => {
    const allEvents: TraceEvent[] = []

    for (const log of logs) {
      allEvents.push({
        type: 'log',
        node: log.node,
        message: log.message,
        timestamp: log.timestamp,
      })
    }

    for (const error of errors) {
      allEvents.push({
        type: 'error',
        node: error.node_name,
        message: error.exception_message,
        timestamp: error.timestamp,
      })
    }

    allEvents.sort((a, b) => a.timestamp - b.timestamp)
    return allEvents
  }, [logs, errors])

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {events.map((event, i) => (
          <div
            key={i}
            className={`text-xs font-mono p-2 rounded ${
              event.type === 'error'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">
                {new Date(event.timestamp * 1000).toLocaleTimeString()}
              </span>
              {event.node && (
                <span className="text-primary/70 font-medium truncate">{event.node}</span>
              )}
            </div>
            {event.message && (
              <div className="mt-0.5 text-foreground break-words">{event.message}</div>
            )}
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground p-4">No events yet</div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
})
