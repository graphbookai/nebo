import { memo } from 'react'
import { RightPanelSettings } from './RightPanelSettings'

export const RightPanel = memo(function RightPanel(_props: { runId: string }) {
  return (
    <div className="h-full flex flex-col border-l border-border">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">
        Settings
      </div>
      <div className="flex-1 overflow-hidden">
        <RightPanelSettings />
      </div>
    </div>
  )
})
