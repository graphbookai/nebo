import type { NodeTab } from '@/store'
import { NodeInfo } from './NodeInfo'
import { NodeLogs } from './NodeLogs'
import { NodeMetrics } from './NodeMetrics'
import { NodeImages } from './NodeImages'
import { NodeAudio } from './NodeAudio'
import { NodeAsk } from './NodeAsk'

interface LoggableTabContentProps {
  runId: string
  loggableId: string
  tab: NodeTab
  comparisonRunIds?: string[]
}

export function LoggableTabContent({ runId, loggableId, tab, comparisonRunIds }: LoggableTabContentProps) {
  switch (tab) {
    case 'info':
      return <NodeInfo runId={runId} loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
    case 'logs':
      return <NodeLogs runId={runId} loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
    case 'metrics':
      return <NodeMetrics runId={runId} loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
    case 'images':
      return <NodeImages runId={runId} loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
    case 'audio':
      return <NodeAudio runId={runId} loggableId={loggableId} comparisonRunIds={comparisonRunIds} />
    case 'ask':
      return <NodeAsk runId={runId} loggableId={loggableId} />
  }
}
