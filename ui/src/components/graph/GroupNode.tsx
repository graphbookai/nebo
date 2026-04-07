import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'

interface GroupNodeData {
  label: string
  width: number
  height: number
}

export const GroupNode = memo(function GroupNode({ data }: NodeProps) {
  const { label, width, height } = data as unknown as GroupNodeData

  return (
    <div
      className="rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/10"
      style={{
        width,
        height,
        padding: 12,
      }}
    >
      <div className="text-xs font-medium text-muted-foreground/60 mb-1">
        {label}
      </div>
    </div>
  )
})
