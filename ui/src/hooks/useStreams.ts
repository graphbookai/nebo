import { useMemo } from 'react'
import { useStore } from '@/store'
import {
  buildStreamPath, buildStreamTree, streamPrefixFor,
  type StreamLeaf, type StreamModality, type StreamModel,
} from '@/lib/streams'

// Resolve each loggableId to its stream prefix using kind + func_name.
function prefixMap(
  graphNodes: Record<string, { func_name: string }> | undefined,
  globalId: string | undefined,
  agentId: string | undefined,
): Map<string, string> {
  const m = new Map<string, string>()
  if (graphNodes) {
    for (const [id, n] of Object.entries(graphNodes)) {
      m.set(id, streamPrefixFor('node', n.func_name, id))
    }
  }
  if (globalId) m.set(globalId, streamPrefixFor('global', '', globalId))
  if (agentId) m.set(agentId, streamPrefixFor('agent', '', agentId))
  return m
}

export function useStreams(runId: string | null): StreamModel {
  const run = useStore(s => (runId ? s.runs.get(runId) : undefined))
  const logs = run?.logs
  const loggableImages = run?.loggableImages
  const loggableAudio = run?.loggableAudio
  const graphNodes = run?.graph?.nodes
  const globalId = run?.globalLoggable?.loggableId
  const agentId = run?.agentLoggable?.loggableId

  return useMemo(() => {
    const prefixes = prefixMap(graphNodes, globalId, agentId)
    // loggables that emitted before register fall back to their id as prefix
    const prefixFor = (id: string | null): string => {
      if (!id) return ''
      if (prefixes.has(id)) return prefixes.get(id)!
      if (id === '__global__') return ''
      if (id === '__agent__') return 'agent'
      return id
    }

    // Accumulate datapoints per full path.
    const acc = new Map<string, StreamLeaf>()
    const push = (loggableId: string, modality: StreamModality, rawName: string | null, step: number | null, timestamp: number) => {
      const name = rawName && rawName.length ? rawName : modality
      const path = buildStreamPath(prefixFor(loggableId), name)
      let leaf = acc.get(path)
      if (!leaf) {
        leaf = {
          path, segments: path.split('/').filter(Boolean),
          loggableId, modality, name,
          datapoints: [], minStep: null, maxStep: null,
          minTime: Infinity, maxTime: -Infinity,
        }
        acc.set(path, leaf)
      }
      leaf.datapoints.push({ step, timestamp })
      if (step != null) {
        leaf.minStep = leaf.minStep == null ? step : Math.min(leaf.minStep, step)
        leaf.maxStep = leaf.maxStep == null ? step : Math.max(leaf.maxStep, step)
      }
      leaf.minTime = Math.min(leaf.minTime, timestamp)
      leaf.maxTime = Math.max(leaf.maxTime, timestamp)
    }

    if (logs) for (const l of logs) push(l.node ?? '__global__', 'text', l.name, l.step ?? null, l.timestamp)
    if (loggableImages) for (const [id, imgs] of Object.entries(loggableImages)) for (const img of imgs) push(id, 'image', img.name, img.step ?? null, img.timestamp)
    if (loggableAudio) for (const [id, entries] of Object.entries(loggableAudio)) for (const a of entries) push(id, 'audio', a.name, a.step ?? null, a.timestamp)

    const leaves = [...acc.values()]
    const byPath = new Map(leaves.map(l => [l.path, l]))
    return { tree: buildStreamTree(leaves), leaves, byPath }
  }, [logs, loggableImages, loggableAudio, graphNodes, globalId, agentId])
}
