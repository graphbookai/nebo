import { useEffect, useRef } from 'react'
import { WebSocketManager } from '@/lib/ws'
import { useStore } from '@/store'
import { api } from '@/lib/api'

export function useWebSocket() {
  const wsRef = useRef<WebSocketManager | null>(null)
  const processWsEvents = useStore(s => s.processWsEvents)
  const setConnectionStatus = useStore(s => s.setConnectionStatus)
  const setRuns = useStore(s => s.setRuns)
  const setRunTree = useStore(s => s.setRunTree)

  useEffect(() => {
    const ws = new WebSocketManager()
    wsRef.current = ws

    // Subscribe to events
    const unsub = ws.subscribe((batch) => {
      if (batch.type === 'batch' && batch.run_id && batch.events) {
        processWsEvents(batch.run_id, batch.events)
      } else if (batch.type === 'tree_updated') {
        setRunTree(batch.data)
      }
    })

    // Poll connection status (skip while the tab is hidden — nothing is
    // painted, and live updates still arrive over the WS on return).
    const statusInterval = setInterval(() => {
      if (document.hidden) return
      setConnectionStatus(ws.connected, ws.reconnecting)
    }, 500)

    // Initial data load (run list + run tree). The tree also arrives live
    // over the WS as tree_updated; this hydrates it on connect.
    const refreshTree = () => {
      api.getTree().then(setRunTree).catch(() => { /* ignore */ })
    }
    api.listRuns()
      .then(data => setRuns(data.runs, data.active_run))
      .catch(() => { /* daemon not running */ })
    refreshTree()

    // Periodic refresh of run list; paused while hidden, refreshed
    // immediately when the tab becomes visible again.
    const refreshRuns = () => {
      api.listRuns()
        .then(data => setRuns(data.runs, data.active_run))
        .catch(() => { /* ignore */ })
    }
    const refreshInterval = setInterval(() => {
      if (document.hidden) return
      refreshRuns()
    }, 5000)
    const onVisible = () => { if (!document.hidden) { refreshRuns(); refreshTree() } }
    document.addEventListener('visibilitychange', onVisible)

    ws.connect()

    return () => {
      unsub()
      clearInterval(statusInterval)
      clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', onVisible)
      ws.disconnect()
    }
  }, [processWsEvents, setConnectionStatus, setRuns, setRunTree])
}
