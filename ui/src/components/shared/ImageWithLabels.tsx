import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import type { LabelsPayload } from '@/lib/api'

const DEFAULT_COLORS: Record<string, string> = {
  points: '#facc15',
  boxes: '#22d3ee',
  circles: '#f472b6',
  polygons: '#86efac',
  bitmask: '#a78bfa',
}

type LabelKey = 'points' | 'boxes' | 'circles' | 'polygons' | 'bitmask'

const ALL_KEYS: LabelKey[] = ['points', 'boxes', 'circles', 'polygons', 'bitmask']

export function ImageWithLabels({
  src,
  labels,
  loggableName,
  imageName,
  alt,
  className,
}: {
  src: string
  labels?: LabelsPayload | null
  loggableName: string
  imageName: string
  alt?: string
  className?: string
}) {
  const labelKeySettings = useStore(s => s.labelKeySettings)
  const registerLabelKey = useStore(s => s.registerLabelKey)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  // Register any keys that have labels present on this image so the
  // Settings pane can surface them.
  useEffect(() => {
    if (!labels) return
    for (const key of ALL_KEYS) {
      const v = labels[key]
      if (v && (Array.isArray(v) ? v.length > 0 : true)) {
        registerLabelKey(loggableName, imageName, key)
      }
    }
  }, [labels, loggableName, imageName, registerLabelKey])

  function setting(k: LabelKey) {
    return labelKeySettings[`${loggableName}|${imageName}|${k}`]
  }
  function visible(k: LabelKey): boolean {
    return setting(k)?.visible ?? true
  }
  function opacity(k: LabelKey): number {
    return (setting(k)?.opacity ?? 70) / 100
  }

  return (
    <div className={`relative inline-block ${className ?? ''}`}>
      <img
        src={src}
        alt={alt ?? imageName}
        className="max-w-full block rounded border border-border"
        onLoad={(e) => {
          const el = e.currentTarget
          setDims({ w: el.naturalWidth, h: el.naturalHeight })
        }}
      />
      {labels && dims && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio="none"
        >
          {labels.points && visible('points') && (
            <g opacity={opacity('points')} fill={DEFAULT_COLORS.points}>
              {labels.points.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={Math.max(1.5, dims.w / 200)} />
              ))}
            </g>
          )}
          {labels.boxes && visible('boxes') && (
            <g
              opacity={opacity('boxes')}
              stroke={DEFAULT_COLORS.boxes}
              fill="none"
              strokeWidth={Math.max(1, dims.w / 200)}
            >
              {labels.boxes.map(([x1, y1, x2, y2], i) => (
                <rect
                  key={i}
                  x={x1}
                  y={y1}
                  width={x2 - x1}
                  height={y2 - y1}
                />
              ))}
            </g>
          )}
          {labels.circles && visible('circles') && (
            <g
              opacity={opacity('circles')}
              stroke={DEFAULT_COLORS.circles}
              fill="none"
              strokeWidth={Math.max(1, dims.w / 200)}
            >
              {labels.circles.map(([x, y, r], i) => (
                <circle key={i} cx={x} cy={y} r={r} />
              ))}
            </g>
          )}
          {labels.polygons && visible('polygons') && (
            <g
              opacity={opacity('polygons')}
              stroke={DEFAULT_COLORS.polygons}
              fill="none"
              strokeWidth={Math.max(1, dims.w / 200)}
            >
              {labels.polygons.map((poly, i) => (
                <polygon
                  key={i}
                  points={poly.map(p => `${p[0]},${p[1]}`).join(' ')}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      {labels?.bitmask && visible('bitmask') && labels.bitmask.map((m, i) => (
        <img
          key={i}
          src={`data:image/png;base64,${m.data}`}
          alt=""
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: opacity('bitmask'), mixBlendMode: 'screen' }}
        />
      ))}
    </div>
  )
}
