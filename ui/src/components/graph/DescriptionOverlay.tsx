import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { FileText, Settings2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'

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
  const [open, setOpen] = useState(false)

  const hasDescription = !!description
  const hasConfig = !!runConfig && Object.keys(runConfig).length > 0
  const hasBoth = hasDescription && hasConfig

  if (!hasDescription && !hasConfig) return null

  const firstLine = description
    ? description.split('\n')[0].replace(/^#\s*/, '')
    : 'Config'

  const markdownContent = hasDescription ? (
    <div className={cn(
      'px-4 py-3 prose prose-sm dark:prose-invert max-w-none',
      'prose-headings:mt-3 prose-headings:mb-1.5',
      '[&_h1]:!text-sm [&_h1]:!font-semibold [&_h2]:!text-xs [&_h2]:!font-semibold [&_h3]:!text-xs',
      'prose-p:text-xs prose-p:leading-relaxed prose-p:my-1.5',
      'prose-li:text-xs prose-li:my-0.5',
      'prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
      'prose-pre:bg-muted prose-pre:text-xs prose-pre:my-2',
    )}>
      <Markdown remarkPlugins={[remarkBreaks]}>{description}</Markdown>
    </div>
  ) : null

  const configContent = hasConfig ? (
    <div className="px-4 py-3">
      <ConfigDisplay config={runConfig!} />
    </div>
  ) : null

  return (
    <div className="absolute top-3 left-3 z-10 w-[360px]">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full h-8 justify-between px-3 gap-1.5 rounded-lg hover:bg-muted/50"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {hasDescription ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Settings2 className="h-3.5 w-3.5 shrink-0" />}
                <span className="max-w-[260px] truncate text-xs font-medium">{firstLine}</span>
              </div>
              <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
            <div className="max-h-[50vh] border-t border-border">
              {hasBoth ? (
                <Tabs defaultValue="md">
                  <TabsList className="justify-start w-full rounded-none border-b border-border bg-transparent h-8 px-2">
                    <TabsTrigger value="md" className="text-xs gap-1 h-6 px-2 data-[state=active]:bg-muted">
                      <FileText className="h-3 w-3" />
                      md
                    </TabsTrigger>
                    <TabsTrigger value="config" className="text-xs gap-1 h-6 px-2 data-[state=active]:bg-muted">
                      <Settings2 className="h-3 w-3" />
                      config
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="md" className="mt-0">
                    <ScrollArea className="max-h-[45vh]">
                      {markdownContent}
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="config" className="mt-0">
                    <ScrollArea className="max-h-[45vh]">
                      {configContent}
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              ) : (
                <ScrollArea className="max-h-[50vh]">
                  {hasDescription ? markdownContent : configContent}
                </ScrollArea>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  )
}
