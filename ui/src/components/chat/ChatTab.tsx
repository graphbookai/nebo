import { memo, useState, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import ReactMarkdown from 'react-markdown'

export const ChatTab = memo(function ChatTab({ runId }: { runId: string }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messages = useStore(s => s.runs.get(runId)?.chatMessages ?? [])
  const sendMessage = useStore(s => s.sendChatMessage)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    const question = input.trim()
    setInput('')
    setLoading(true)
    try {
      await sendMessage(runId, question)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg p-3 ${
                msg.role === 'user'
                  ? 'bg-primary/10 ml-8'
                  : 'bg-muted mr-8'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          ))}
          {loading && (
            <div className="text-sm text-muted-foreground p-3">Thinking...</div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="border-t border-border p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about this run..."
            className="flex-1 text-sm bg-muted rounded-md px-3 py-2 outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
})
