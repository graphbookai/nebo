import { useState } from 'react'
import { Maximize2, Maximize, Download, Link as LinkIcon, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface HeaderActionsProps {
  onExpand: () => void
  onDownloadPng?: () => void
  // Iframe-embeddable URL. Comparison blocks omit this since they span
  // multiple runs and the embedded-view schema only addresses one.
  iframeUrl?: string
  onResetZoom?: () => void
}

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

