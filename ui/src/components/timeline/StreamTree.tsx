import { useMemo, useState } from 'react'
import { ChevronRight, FileText, Image as ImageIcon, AudioLines } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useStore } from '@/store'
import type { StreamTreeNode, StreamModality } from '@/lib/streams'

const ICON: Record<StreamModality, typeof FileText> = { text: FileText, image: ImageIcon, audio: AudioLines }

// Flatten the tree into visible rows honoring collapse state + a search query.
// A branch is kept if any descendant leaf path matches the query.
export interface FlatRow { node: StreamTreeNode; depth: number; isLeaf: boolean }

function flatten(nodes: StreamTreeNode[], depth: number, collapsed: Set<string>, q: string, out: FlatRow[]) {
  for (const n of nodes) {
    const matches = !q || n.path.toLowerCase().includes(q)
    const isLeaf = n.leaf != null && n.children.length === 0
    if (isLeaf) {
      if (matches) out.push({ node: n, depth, isLeaf: true })
      continue
    }
    // branch: include if it or any descendant matches
    const childOut: FlatRow[] = []
    if (!collapsed.has(n.path)) flatten(n.children, depth + 1, collapsed, q, childOut)
    const anyChild = childOut.length > 0
    if (matches || anyChild || (q && subtreeMatches(n, q))) {
      out.push({ node: n, depth, isLeaf: false })
      if (!collapsed.has(n.path)) {
        if (childOut.length) out.push(...childOut)
        else if (q) flatten(n.children, depth + 1, collapsed, q, out)
      }
    }
  }
}
function subtreeMatches(n: StreamTreeNode, q: string): boolean {
  if (n.path.toLowerCase().includes(q)) return true
  return n.children.some(c => subtreeMatches(c, q))
}

interface Props {
  nodes: StreamTreeNode[]
  rowHeight: number
  onSelect: (path: string) => void
}

export function StreamTree({ nodes, rowHeight, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const selected = useStore(s => s.timeline.selectedStream)

  const rows = useMemo(() => {
    const out: FlatRow[] = []
    flatten(nodes, 0, collapsed, query.trim().toLowerCase(), out)
    return out
  }, [nodes, collapsed, query])

  const toggle = (path: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })

  return (
    <div className="flex h-full flex-col">
      <div className="p-1.5 border-b border-border">
        <Input placeholder="Search streams…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-6" />
      </div>
      <ScrollArea className="flex-1">
        <div>
          {rows.map(({ node, depth, isLeaf }) => {
            const Icon = isLeaf && node.leaf ? ICON[node.leaf.modality] : null
            const isSel = isLeaf && node.leaf?.path === selected
            return (
              <div
                key={node.path}
                style={{ height: rowHeight, paddingLeft: 6 + depth * 12 }}
                className={`flex items-center gap-1 pr-2 text-[11px] cursor-pointer select-none ${isSel ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
                onClick={() => isLeaf && node.leaf ? onSelect(node.leaf.path) : toggle(node.path)}
              >
                {!isLeaf ? (
                  <ChevronRight size={12} className={`shrink-0 transition-transform ${collapsed.has(node.path) ? '' : 'rotate-90'}`} />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                {Icon && <Icon size={11} className="shrink-0" />}
                <span className="truncate">{node.key}{!isLeaf ? '/' : ''}</span>
              </div>
            )
          })}
          {rows.length === 0 && <div className="p-3 text-[11px] text-muted-foreground">No streams</div>}
        </div>
      </ScrollArea>
    </div>
  )
}
