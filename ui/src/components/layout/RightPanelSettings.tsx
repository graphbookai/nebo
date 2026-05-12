import { useMemo } from 'react'
import { ImageIcon, LineChart as LineIcon, BarChart3 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useStore, type Settings as SettingsType } from '@/store'
import { useComparisonContext } from '@/hooks/useComparisonContext'

function ChartSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-primary cursor-pointer"
      />
    </div>
  )
}

// Per-run settings surface that lives in the right panel. Hosts the
// global chart knobs (line/histogram smoothing and bin count) and any
// image-label controls registered by the currently-viewed run.
export function RightPanelSettings() {
  const labelKeySettings = useStore(s => s.labelKeySettings)
  const setLabelKeyVisible = useStore(s => s.setLabelKeyVisible)
  const setLabelKeyOpacity = useStore(s => s.setLabelKeyOpacity)
  const settings = useStore(s => s.settings)
  const updateSetting = useStore(s => s.updateSetting)
  const runs = useStore(s => s.runs)
  const { runIds } = useComparisonContext()

  // labelKeySettings is global (keyed by loggable|image|key), but each
  // controls section should only surface entries that match images
  // present in the currently-viewed run(s). Otherwise switching runs
  // leaves stale toggles in place for label keys that don't exist here.
  const visibleEntries = useMemo(() => {
    if (runIds.length === 0) return [] as [string, typeof labelKeySettings[string]][]
    const activePairs = new Set<string>()
    for (const rid of runIds) {
      const run = runs.get(rid)
      if (!run) continue
      for (const [loggableId, images] of Object.entries(run.loggableImages)) {
        for (const img of images) {
          activePairs.add(`${loggableId}|${img.name}`)
        }
      }
    }
    return Object.entries(labelKeySettings).filter(([triple]) => {
      const [loggable, image] = triple.split('|')
      return activePairs.has(`${loggable}|${image}`)
    })
  }, [labelKeySettings, runs, runIds])

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <LineIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Line charts</h3>
        </div>
        <ChartSlider
          label="Smoothing"
          value={settings.lineSmoothing}
          min={0}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => updateSetting<keyof SettingsType>('lineSmoothing', v)}
        />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Histogram charts</h3>
        </div>
        <div className="space-y-3">
          <ChartSlider
            label="Smoothing"
            value={settings.histogramSmoothing}
            min={0}
            max={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => updateSetting<keyof SettingsType>('histogramSmoothing', v)}
          />
          <ChartSlider
            label="Bins"
            value={settings.histogramBinCount}
            min={5}
            max={100}
            step={1}
            onChange={(v) => updateSetting<keyof SettingsType>('histogramBinCount', v)}
          />
        </div>
      </section>

      {visibleEntries.length > 0 && (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Image labels</h3>
          <span className="text-xs text-muted-foreground">
            ({visibleEntries.length})
          </span>
        </div>

        <div className="space-y-4">
          {visibleEntries.map(([triple, s]) => {
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
      </section>
      )}
    </div>
  )
}
