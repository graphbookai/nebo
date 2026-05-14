// PNG-download helpers used by HeaderActions. Kept separate so the
// component module exports only React components (react-refresh
// otherwise can't fast-refresh files that mix component + utility
// exports).

export function downloadCanvasPng(container: HTMLElement | null, name: string): void {
  if (!container) return
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
  if (!canvas) return
  // Chart.js canvases are transparent by default, which renders as
  // unreadable plot lines on whatever background the consumer pastes
  // into. Composite onto the theme's card color (which is what the
  // chart sits on in both DAG-node and grid views) before exporting.
  const composed = document.createElement('canvas')
  composed.width = canvas.width
  composed.height = canvas.height
  const ctx = composed.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = resolveThemeBg()
  ctx.fillRect(0, 0, composed.width, composed.height)
  ctx.drawImage(canvas, 0, 0)
  triggerDownload(composed.toDataURL('image/png'), sanitizeFileName(name) + '.png')
}

function resolveThemeBg(): string {
  const cs = getComputedStyle(document.documentElement)
  // Prefer --color-card (the surface the chart actually sits on);
  // fall back to --color-background, then opaque white.
  const card = cs.getPropertyValue('--color-card').trim()
  if (card) return card
  const bg = cs.getPropertyValue('--color-background').trim()
  if (bg) return bg
  return '#ffffff'
}

export function downloadImageElement(img: HTMLImageElement | null, name: string): void {
  if (!img) return
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, 0, 0)
  triggerDownload(canvas.toDataURL('image/png'), sanitizeFileName(name) + '.png')
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_') || 'export'
}
