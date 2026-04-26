import { memo, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TraceTab } from '@/components/trace/TraceTab'
import { ChatTab } from '@/components/chat/ChatTab'
import { RightPanelSettings } from './RightPanelSettings'
import { useStore, type RightPanelTab } from '@/store'
import { useComparisonContext } from '@/hooks/useComparisonContext'

export const RightPanel = memo(function RightPanel({ runId }: { runId: string }) {
  const tab = useStore(s => s.rightPanelTab)
  const setTab = useStore(s => s.setRightPanelTab)
  const { isComparison } = useComparisonContext()

  // Trace and chat are run-specific; hide them in comparison views and snap
  // back to settings if the user was on one of those tabs.
  useEffect(() => {
    if (isComparison && (tab === 'trace' || tab === 'chat')) {
      setTab('settings')
    }
  }, [isComparison, tab, setTab])

  return (
    <div className="h-full flex flex-col border-l border-border">
      <Tabs value={tab} onValueChange={v => setTab(v as RightPanelTab)} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-border px-2">
          {!isComparison && <TabsTrigger value="trace">Trace</TabsTrigger>}
          {!isComparison && <TabsTrigger value="chat">Chat</TabsTrigger>}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        {!isComparison && (
          <TabsContent value="trace" className="flex-1 mt-0 overflow-hidden">
            <TraceTab runId={runId} />
          </TabsContent>
        )}
        {!isComparison && (
          <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
            <ChatTab runId={runId} />
          </TabsContent>
        )}
        <TabsContent value="settings" className="flex-1 mt-0 overflow-hidden">
          <RightPanelSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
})
