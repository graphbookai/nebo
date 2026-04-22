import { useStore } from '@/store'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { ContextMenuItem } from '@/components/shared/ContextMenuItem'
import { Network, LayoutGrid } from 'lucide-react'

interface GraphContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
}

export function GraphContextMenu({ isOpen, position, onClose }: GraphContextMenuProps) {
  const viewMode = useStore(s => s.viewMode)
  const setViewMode = useStore(s => s.setViewMode)

  return (
    <ContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      <ContextMenuItem
        label="Graph View"
        icon={<Network className="w-4 h-4" />}
        checked={viewMode === 'graph'}
        onClick={() => { setViewMode('graph'); onClose() }}
      />
      <ContextMenuItem
        label="Grid View"
        icon={<LayoutGrid className="w-4 h-4" />}
        checked={viewMode === 'grid'}
        onClick={() => { setViewMode('grid'); onClose() }}
      />
    </ContextMenu>
  )
}
