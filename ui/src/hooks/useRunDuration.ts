import { useState, useEffect } from 'react'
import { formatDuration } from '@/lib/utils'
import type { RunSummary } from '@/lib/api'

/**
 * Returns a formatted duration string for a run.
 * - Live (started, no ended_at yet): live-ticking elapsed time (updates every second)
 * - Ended: fixed duration (ended_at - started_at)
 */
export function useRunDuration(summary: RunSummary | undefined): string {
  const [now, setNow] = useState(Date.now())
  const isActive = Boolean(summary?.started_at && !summary?.ended_at)

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActive])

  if (!summary?.started_at) return '—'

  const startMs = new Date(summary.started_at).getTime()

  if (summary.ended_at) {
    const endMs = new Date(summary.ended_at).getTime()
    return formatDuration(endMs - startMs)
  }

  return formatDuration(now - startMs)
}
