import { toPng, toJpeg, toSvg } from 'html-to-image'
import jsPDF from 'jspdf'
import type { GraphData } from '@/lib/api'

interface ExportOpts {
  filename?: string
  backgroundColor?: string
  pixelRatio?: number
}

function trigger(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',', 2)
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

const DEFAULTS: Required<Pick<ExportOpts, 'backgroundColor' | 'pixelRatio'>> = {
  backgroundColor: '#0a0a0a',
  pixelRatio: 2,
}

export async function exportAsPng(el: HTMLElement, opts: ExportOpts = {}): Promise<void> {
  const url = await toPng(el, {
    backgroundColor: opts.backgroundColor ?? DEFAULTS.backgroundColor,
    pixelRatio: opts.pixelRatio ?? DEFAULTS.pixelRatio,
    cacheBust: true,
  })
  trigger(dataUrlToBlob(url), opts.filename ?? 'nebo-dag.png')
}

export async function exportAsJpg(el: HTMLElement, opts: ExportOpts = {}): Promise<void> {
  const url = await toJpeg(el, {
    backgroundColor: opts.backgroundColor ?? DEFAULTS.backgroundColor,
    pixelRatio: opts.pixelRatio ?? DEFAULTS.pixelRatio,
    quality: 0.95,
    cacheBust: true,
  })
  trigger(dataUrlToBlob(url), opts.filename ?? 'nebo-dag.jpg')
}

export async function exportAsSvg(el: HTMLElement, opts: ExportOpts = {}): Promise<void> {
  const url = await toSvg(el, {
    backgroundColor: opts.backgroundColor ?? DEFAULTS.backgroundColor,
    cacheBust: true,
  })
  trigger(dataUrlToBlob(url), opts.filename ?? 'nebo-dag.svg')
}

export async function exportAsPdf(el: HTMLElement, opts: ExportOpts = {}): Promise<void> {
  const url = await toPng(el, {
    backgroundColor: opts.backgroundColor ?? DEFAULTS.backgroundColor,
    pixelRatio: opts.pixelRatio ?? DEFAULTS.pixelRatio,
    cacheBust: true,
  })
  // Size the PDF page to match the captured image so the diagram doesn't
  // get cropped or letterboxed.
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = url
  })
  const orientation = img.width >= img.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ unit: 'px', format: [img.width, img.height], orientation })
  pdf.addImage(url, 'PNG', 0, 0, img.width, img.height)
  pdf.save(opts.filename ?? 'nebo-dag.pdf')
}

interface DrawioPos {
  x: number
  y: number
  width: number
  height: number
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generate a draw.io / mxfile XML document from a nebo graph and the layout
 * positions React Flow used to lay it out. Importable directly in
 * https://app.diagrams.net.
 */
export function buildDrawioXml(
  graph: GraphData,
  positions: Map<string, DrawioPos>,
): string {
  const cells: string[] = [
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
  ]

  // Stable id allocator for edges (drawio cell ids must be unique).
  let edgeCounter = 0

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const pos = positions.get(nodeId) ?? { x: 0, y: 0, width: 200, height: 80 }
    const label = node.func_name || nodeId
    const style = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#1f2937;strokeColor=#374151;fontColor=#e5e7eb;'
    cells.push(
      `<mxCell id="${escapeXml(nodeId)}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" as="geometry"/>` +
      `</mxCell>`,
    )
  }

  for (const edge of graph.edges) {
    const id = `e${edgeCounter++}`
    cells.push(
      `<mxCell id="${id}" edge="1" parent="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}" style="endArrow=classic;html=1;strokeColor=#6b7280;">` +
      `<mxGeometry relative="1" as="geometry"/>` +
      `</mxCell>`,
    )
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="nebo">` +
    `<diagram name="nebo-dag" id="nebo-dag">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">` +
    `<root>${cells.join('')}</root>` +
    `</mxGraphModel>` +
    `</diagram>` +
    `</mxfile>`
  )
}

export function exportAsDrawio(
  graph: GraphData,
  positions: Map<string, DrawioPos>,
  filename = 'nebo-dag.drawio',
): void {
  const xml = buildDrawioXml(graph, positions)
  trigger(new Blob([xml], { type: 'application/xml' }), filename)
}
