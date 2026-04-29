import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  // Modal max width. Defaults to a reading-comfortable 4xl. Pass a Tailwind
  // class like 'max-w-6xl' to override.
  widthClass?: string
  children: React.ReactNode
}

// Lightweight modal with a portaled overlay. Closes on ESC or backdrop
// click. We don't pull in @radix-ui/react-dialog because the rest of
// the UI already manages focus restoration on its own and the modal
// only needs to host an existing card body in a larger viewport.
export function Modal({ open, onClose, title, widthClass, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Lock body scroll while the modal is open so the page behind
    // doesn't shift on touch trackpads.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        // Only close when the click started on the backdrop itself,
        // not when a drag-select or text-selection inside the modal
        // happens to release over the backdrop.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'bg-popover text-popover-foreground border border-border rounded-lg shadow-2xl flex flex-col w-full max-h-[90vh]',
          widthClass ?? 'max-w-4xl',
        )}
        // Stop click bubbling so backdrop close logic above doesn't
        // fire for clicks inside the modal body.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <div className="flex-1 min-w-0">
            {typeof title === 'string'
              ? <span className="text-sm font-medium truncate block">{title}</span>
              : title}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
