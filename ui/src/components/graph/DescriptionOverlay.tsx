import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { FileText, Settings2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface DescriptionOverlayProps {
  runId: string
}

function ConfigDisplay({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config)
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">Empty config</span>

  return (
    <div className="space-y-1 font-mono text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="text-muted-foreground shrink-0">{key}:</span>
          <span className="text-foreground break-all">
            {typeof value === 'object' && value !== null
              ? JSON.stringify(value, null, 2)
              : String(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function DescriptionOverlay({ runId }: DescriptionOverlayProps) {
  const description = useStore(s => s.runs.get(runId)?.graph?.workflow_description)
  const runConfig = useStore(s => s.runs.get(runId)?.graph?.run_config)
  const [expanded, setExpanded] = useState(false)

  const hasDescription = !!description
  const hasConfig = !!runConfig && Object.keys(runConfig).length > 0
  const hasBoth = hasDescription && hasConfig

  if (!hasDescription && !hasConfig) return null

  const firstLine = description
    ? description.split('\n')[0].replace(/^#\s*/, '')
    : 'Config'

  if (!expanded) {
    return (
      <div className="absolute top-3 left-3 z-10">
        <Button
          variant="outline"
          size="sm"
          className="h-8 bg-card/80 backdrop-blur-sm gap-1.5"
          onClick={() => setExpanded(true)}
          title={firstLine}
        >
          {hasDescription ? <FileText className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
          <span className="max-w-[180px] truncate text-xs">{firstLine}</span>
        </Button>
      </div>
    )
  }

  const markdownContent = (
    <div className={cn(
      'px-4 py-3 prose prose-sm dark:prose-invert max-w-none',
      'prose-headings:mt-3 prose-headings:mb-1.5',
      '[&_h1]:!text-lg [&_h1]:!font-semibold [&_h2]:!text-base [&_h3]:!text-sm',
      'prose-p:text-xs prose-p:leading-relaxed prose-p:my-1.5',
      'prose-li:text-xs prose-li:my-0.5',
      'prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
      'prose-pre:bg-muted prose-pre:text-xs prose-pre:my-2',
    )}>
      <Markdown remarkPlugins={[remarkBreaks]}>{description}</Markdown>
    </div>
  )

  const configContent = hasConfig ? (
    <div className="px-4 py-3">
      <ConfigDisplay config={runConfig!} />
    </div>
  ) : null

  return (
    <div className="absolute top-3 left-3 z-10 w-[360px] max-h-[60vh]">
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg flex flex-col max-h-[60vh]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          {!hasBoth && (
            <div className="flex items-center gap-1.5">
              {hasDescription ? <FileText className="h-3.5 w-3.5 text-muted-foreground" /> : <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-xs font-medium">{hasDescription ? 'Pipeline Description' : 'Run Config'}</span>
            </div>
          )}
          {hasBoth && (
            <span className="text-xs font-medium sr-only">Description &amp; Config</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-auto"
            onClick={() => setExpanded(false)}
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {hasBoth ? (
          <Tabs defaultValue="md" className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="mx-3 mt-2 h-7">
              <TabsTrigger value="md" className="text-xs gap-1 h-5 px-2">
                <FileText className="h-3 w-3" />
                Description
              </TabsTrigger>
              <TabsTrigger value="config" className="text-xs gap-1 h-5 px-2">
                <Settings2 className="h-3 w-3" />
                Config
              </TabsTrigger>
            </TabsList>
            <TabsContent value="md" className="flex-1 overflow-auto">
              <ScrollArea className="max-h-[45vh]">
                {markdownContent}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="config" className="flex-1 overflow-auto">
              <ScrollArea className="max-h-[45vh]">
                {configContent}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <ScrollArea className="flex-1 overflow-auto">
            {hasDescription ? markdownContent : configContent}
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
