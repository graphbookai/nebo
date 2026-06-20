// Pure helpers for deriving stream paths and assembling the stream tree.
// A "stream" is a named series of datapoints within one loggable. Its full
// path is /<prefix>/<name> where prefix is the function name (nodes),
// "agent" (the __agent__ loggable), or "" (global, root-level).

export type StreamModality = 'text' | 'image' | 'audio'

export interface StreamDatapoint {
  step: number | null
  timestamp: number
}

export interface StreamLeaf {
  path: string           // "/foo/train/loss"
  segments: string[]     // ["foo","train","loss"]
  loggableId: string
  modality: StreamModality
  name: string           // entry name within the loggable, e.g. "train/loss"
  datapoints: StreamDatapoint[]
  minStep: number | null
  maxStep: number | null
  minTime: number
  maxTime: number
}

export interface StreamTreeNode {
  key: string                  // segment label at this depth
  path: string                 // full path through this segment ("/foo", "/foo/train")
  children: StreamTreeNode[]
  leaf: StreamLeaf | null      // set when a stream terminates exactly here
}

export interface StreamModel {
  tree: StreamTreeNode[]
  leaves: StreamLeaf[]
  byPath: Map<string, StreamLeaf>
}

export function streamPrefixFor(
  kind: 'node' | 'global' | 'agent',
  funcName: string,
  loggableId: string,
): string {
  if (kind === 'global') return ''
  if (kind === 'agent') return 'agent'
  return funcName || loggableId
}

export function buildStreamPath(prefix: string, name: string): string {
  const segs = [
    ...(prefix ? prefix.split('/') : []),
    ...(name ? name.split('/') : []),
  ].filter(Boolean)
  return '/' + segs.join('/')
}

// Assemble a nested tree from flat leaves. Intermediate path segments become
// branch nodes (leaf === null); a leaf attaches at the node whose path equals
// the leaf's path. Children are sorted: branches before leaves, then by key.
export function buildStreamTree(leaves: StreamLeaf[]): StreamTreeNode[] {
  const roots: StreamTreeNode[] = []
  const index = new Map<string, StreamTreeNode>()

  const getNode = (segments: string[]): StreamTreeNode => {
    let path = ''
    let siblings = roots
    let node: StreamTreeNode | undefined
    for (const seg of segments) {
      path = path + '/' + seg
      node = index.get(path)
      if (!node) {
        node = { key: seg, path, children: [], leaf: null }
        index.set(path, node)
        siblings.push(node)
      }
      siblings = node.children
    }
    return node!
  }

  for (const leaf of leaves) {
    const node = getNode(leaf.segments)
    node.leaf = leaf
  }

  const sortRec = (nodes: StreamTreeNode[]) => {
    nodes.sort((a, b) => {
      const aBranch = a.children.length > 0
      const bBranch = b.children.length > 0
      if (aBranch !== bBranch) return aBranch ? -1 : 1
      return a.key.localeCompare(b.key)
    })
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}
