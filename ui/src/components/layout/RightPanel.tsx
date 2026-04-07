import { memo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TraceTab } from '@/components/trace/TraceTab'
import { ChatTab } from '@/components/chat/ChatTab'
import { useStore } from '@/store'

export const RightPanel = memo(function RightPanel({ runId }: { runId: string }) {
  const tab = useStore(s => s.rightPanelTab)
  const setTab = useStore(s => s.setRightPanelTab)

  return (
    <div className="h-full flex flex-col border-l border-border">
      <Tabs value={tab} onValueChange={v => setTab(v as 'trace' | 'chat')} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-border px-2">
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>
        <TabsContent value="trace" className="flex-1 mt-0 overflow-hidden">
          <TraceTab runId={runId} />
        </TabsContent>
        <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
          <ChatTab runId={runId} />
        </TabsContent>
      </Tabs>
    </div>
  )
})
