import { useState } from 'react'
import { Maximize2, Maximize, Download, Link as LinkIcon, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface HeaderActionsProps {
  onExpand: () => void
  // Trigger a PNG download. Caller knows where the canvas/image lives
  // (chart container ref or <img> src); this component only renders the
  // affordance. Pass undefined to hide the Download button entirely.
  onDownloadPng?: () => void
  // Iframe-embeddable URL for this specific block (e.g.
  // `${origin}/?run=R&metric=NAME&node=NODE`). Pass undefined to omit the
  // "Copy iframe URL" row from the Download popover — comparison-view
  // blocks have no single run to embed so they hide the row.
  iframeUrl?: string
  // Reset chart pan/zoom. Pass undefined to hide the button — snapshot
  // chart types (bar / pie) have no zoom state to reset.
  onResetZoom?: () => void
}

// Shared header chrome for metric and image blocks: Reset zoom (when
// applicable) + Expand to a modal + Download popover (PNG download /
// Copy iframe URL). Lives where the chart-type label used to sit on the
// right of the block header.
export function HeaderActions({ onExpand, onDownloadPng, iframeUrl, onResetZoom }: HeaderActionsProps) {
  const [copied, setCopied] = useState(false)

  const copyIframeUrl = () => {
    if (!iframeUrl) return
    void navigator.clipboard?.writeText(iframeUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const showDownload = !!onDownloadPng || !!iframeUrl

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {onResetZoom && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onResetZoom}
          title="Reset zoom"
        >
          <Maximize className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onExpand}
        title="Expand"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      {showDownload && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <div className="flex flex-col">
              {onDownloadPng && (
                <button
                  type="button"
                  onClick={onDownloadPng}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PNG
                </button>
              )}
              {iframeUrl && (
                <button
                  type="button"
                  onClick={copyIframeUrl}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <LinkIcon className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy iframe URL'}
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

