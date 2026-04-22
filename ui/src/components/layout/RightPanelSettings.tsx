import { ImageIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/store'

// Per-run settings surface that lives in the right panel alongside
// Trace and Chat. For now this just hosts the image-label controls.
export function RightPanelSettings() {
  const labelKeySettings = useStore(s => s.labelKeySettings)
  const setLabelKeyVisible = useStore(s => s.setLabelKeyVisible)
  const setLabelKeyOpacity = useStore(s => s.setLabelKeyOpacity)

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Image labels</h3>
          {Object.keys(labelKeySettings).length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({Object.keys(labelKeySettings).length})
            </span>
          )}
        </div>

        {Object.keys(labelKeySettings).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Label controls appear here once a loggable emits an image with
            <code className="mx-1">points</code>
            /
            <code className="mx-1">boxes</code>
            /
            <code className="mx-1">circles</code>
            /
            <code className="mx-1">polygons</code>
            /
            <code className="mx-1">bitmask</code>.
          </p>
        ) : (
          <div className="space-y-4">
            {Object.entries(labelKeySettings).map(([triple, s]) => {
              const [loggable, image, key] = triple.split('|')
              return (
                <div key={triple} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs text-muted-foreground truncate"
                      title={`${loggable} > ${image} > ${key}`}
                    >
                      {loggable} › {image} ›{' '}
                      <span className="font-medium text-foreground">{key}</span>
                    </span>
                    <Switch
                      checked={s.visible}
                      onCheckedChange={(v) => setLabelKeyVisible(loggable, image, key, v)}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={s.opacity}
                    onChange={(e) =>
                      setLabelKeyOpacity(loggable, image, key, Number(e.target.value))
                    }
                    disabled={!s.visible}
                    className="w-full h-1 accent-primary cursor-pointer disabled:opacity-40"
                    aria-label={`${key} opacity`}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
