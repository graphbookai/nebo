import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { useStore } from '@/store'
import { ExportNode } from './ExportNode'
import { NeboEdge } from '@/components/graph/NeboEdge'
import type { ExportOptions } from './types'

export interface NodePos {
  x: number
  y: number
  width: number
  height: number
}

interface DiagramExportRootProps {
  runId: string
  options: ExportOptions
  livePositions?: Map<string, NodePos>
  onReady: (root: HTMLElement) => void
}

const nodeTypes: NodeTypes = { nebo: ExportNode }
const edgeTypes = { nebo: NeboEdge }

const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 200
const PADDING_TIGHT = 16
const PADDING_COMFY = 48

function runDagreLayout(
  baseNodes: Node[],
  edges: Edge[],
  measured: Map<string, { width: number; height: number }> | undefined,
  rankdir: 'TB' | 'LR',
): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, nodesep: 50, ranksep: 60 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const node of baseNodes) {
    const dims = measured?.get(node.id)
    g.setNode(node.id, {
      width: dims?.width ?? DEFAULT_WIDTH,
      height: dims?.height ?? DEFAULT_HEIGHT,
    })
  }
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return baseNodes.map(node => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
    }
  })
}

function computeBounds(nodes: Node[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 800, height: 600 }
  let maxX = 0
  let maxY = 0
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    const w = n.measured?.width ?? DEFAULT_WIDTH
    const h = n.measured?.height ?? DEFAULT_HEIGHT
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  return { width: Math.max(0, maxX - Math.min(0, minX)), height: Math.max(0, maxY - Math.min(0, minY)) }
}

function shiftToOrigin(nodes: Node[], pad: number): Node[] {
  if (nodes.length === 0) return nodes
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
  }
  const dx = pad - minX
  const dy = pad - minY
  return nodes.map(n => ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }))
}

function DiagramExportRootInner({ runId, options, livePositions, onReady }: DiagramExportRootProps) {
  const graph = useStore(s => s.runs.get(runId)?.graph)
  const hideUncalled = useStore(s => s.settings.hideUncalledFunctions)
  const dagDirection = useStore(s => s.dagDirection)

  const [nodes, setNodes] = useNodesState([] as Node[])
  const [edges, setEdges] = useEdgesState([] as Edge[])
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null)
  // `layoutDone.current` is a ref, so we mirror it as state to drive the
  // ready-fire effect below without relying on side-channel refs.
  const [layoutReady, setLayoutReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const layoutDone = useRef(false)
  const readyFired = useRef(false)

  const padding = options.padding === 'tight' ? PADDING_TIGHT : PADDING_COMFY
  const themeBg = options.theme === 'light' ? '#ffffff' : '#0a0a0a'

  const { baseNodes, baseEdges } = useMemo(() => {
    if (!graph) return { baseNodes: [] as Node[], baseEdges: [] as Edge[] }
    const targetSet = new Set(graph.edges.map(e => e.target))
    const sourceSet = new Set(graph.edges.map(e => e.source))
    const visibleIds = Object.keys(graph.nodes).filter(
      id => !hideUncalled || graph.nodes[id].exec_count > 0,
    )
    const visibleSet = new Set(visibleIds)
    const baseNodes: Node[] = visibleIds.map(id => ({
      id,
      type: 'nebo' as const,
      position: { x: 0, y: 0 },
      data: {
        nodeId: id,
        runId,
        options,
        direction: dagDirection,
        inDag: sourceSet.has(id) || targetSet.has(id) || graph.nodes[id].is_source,
      },
    }))
    const baseEdges: Edge[] = graph.edges
      .filter(e => visibleSet.has(e.source) && visibleSet.has(e.target))
      .map(e => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: 'nebo',
        data: { runId },
      }))
    return { baseNodes, baseEdges }
  }, [graph, hideUncalled, runId, options, dagDirection])

  // Initial render: place nodes either at livePositions (autoLayout=off) or
  // at default-size dagre coords (autoLayout=on, real layout runs after the
  // first paint once measured dimensions land).
  useEffect(() => {
    if (baseNodes.length === 0) {
      setNodes([])
      setEdges([])
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContainerSize({ width: 800, height: 600 })
      return
    }
    layoutDone.current = false
    readyFired.current = false
    if (!options.autoLayout && livePositions) {
      const placed = baseNodes.map(n => {
        const p = livePositions.get(n.id)
        return p
          ? { ...n, position: { x: p.x, y: p.y } }
          : n
      })
      const shifted = shiftToOrigin(placed, padding)
      const fakeMeasured = new Map<string, { width: number; height: number }>()
      for (const n of placed) {
        const p = livePositions.get(n.id)
        if (p) fakeMeasured.set(n.id, { width: p.width, height: p.height })
      }
      const sized = computeBounds(
        shifted.map(n => ({ ...n, measured: fakeMeasured.get(n.id) })),
      )
      setNodes(shifted)
      setEdges(baseEdges)
      setContainerSize({ width: sized.width + padding * 2, height: sized.height + padding * 2 })
      // No measurement pass needed for live positions.
      layoutDone.current = true
      setLayoutReady(true)
    } else {
      const laid = runDagreLayout(baseNodes, baseEdges, undefined, dagDirection)
      const shifted = shiftToOrigin(laid, padding)
      setNodes(shifted)
      setEdges(baseEdges)
      const bounds = computeBounds(shifted)
      setContainerSize({ width: bounds.width + padding * 2, height: bounds.height + padding * 2 })
    }
  }, [baseNodes, baseEdges, options.autoLayout, livePositions, dagDirection, padding, setNodes, setEdges])

  // Second-pass dagre after the offscreen DOM has had a chance to render.
  // We poll the rendered React Flow nodes directly via getBoundingClientRect
  // rather than relying on `useNodesInitialized` — that hook does not flip
  // true reliably for the offscreen tree (likely because the node observers
  // ignore far-offscreen positions).
  useEffect(() => {
    if (!options.autoLayout) return
    if (layoutDone.current || nodes.length === 0) return
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let attempt = 0
    const tryMeasure = () => {
      if (cancelled || layoutDone.current) return
      const flowNodes = container.querySelectorAll<HTMLElement>('.react-flow__node')
      const dims = new Map<string, { width: number; height: number }>()
      for (const el of Array.from(flowNodes)) {
        const id = el.getAttribute('data-id')
        if (!id) continue
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          dims.set(id, { width: r.width, height: r.height })
        }
      }
      if (dims.size === nodes.length) {
        const laid = runDagreLayout(nodes, baseEdges, dims, dagDirection)
        const shifted = shiftToOrigin(laid, padding)
        setNodes(shifted.map(n => ({ ...n, measured: dims.get(n.id) })))
        const bounds = computeBounds(shifted.map(n => ({ ...n, measured: dims.get(n.id) })))
        setContainerSize({ width: bounds.width + padding * 2, height: bounds.height + padding * 2 })
        layoutDone.current = true
        setLayoutReady(true)
        return
      }
      attempt += 1
      if (attempt > 30) {
        // Fallback: declare layout done with whatever measurements we have.
        // Better to render with default sizes than to stall the export.
        layoutDone.current = true
        setLayoutReady(true)
        return
      }
      window.setTimeout(tryMeasure, 50)
    }
    tryMeasure()
    return () => { cancelled = true }
  }, [nodes, baseEdges, dagDirection, padding, options.autoLayout, setNodes])

  // Fire onReady once layout has settled. When tabbed content is on,
  // give Chart.js a frame plus a small buffer to draw to its canvases
  // before the orchestrator snapshots.
  useEffect(() => {
    if (!layoutReady || readyFired.current) return
    if (!containerRef.current) return
    const settle = options.tabbedContent === 'active' ? 200 : 50
    const id = window.setTimeout(() => {
      if (readyFired.current || !containerRef.current) return
      readyFired.current = true
      onReady(containerRef.current)
    }, settle)
    return () => window.clearTimeout(id)
  }, [layoutReady, options.tabbedContent, onReady])

  if (!graph || !containerSize) {
    return null
  }

  const containerStyle: CSSProperties = {
    width: containerSize.width,
    height: containerSize.height,
    backgroundColor: themeBg,
    position: 'relative',
  }

  return (
    <div
      ref={containerRef}
      data-export-root
      className={options.theme === 'dark' ? 'dark' : ''}
      style={containerStyle}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={1}
          maxZoom={1}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        />
      </div>
    </div>
  )
}

export function DiagramExportRoot(props: DiagramExportRootProps) {
  return (
    <ReactFlowProvider>
      <DiagramExportRootInner {...props} />
    </ReactFlowProvider>
  )
}
