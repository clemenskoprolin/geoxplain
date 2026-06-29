import { useEffect, useMemo, useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  attributionPaletteGradient,
  attributionPaletteLabel,
  customColorSchemeGradientCss,
  orderedAttributionUiPalettes,
  orderedContourPalettes,
} from '@/lib/attributionColor'
import type { AttributionColorScheme, AttributionPresetColormap, PressureLevel } from '@/types'

const IMPORTED_GRID_SIGMA_MIN = 0.1
const IMPORTED_GRID_SIGMA_MAX = 3
const IMPORTED_GRID_SIGMA_STEP = 0.1
const DENSE_LAYER_COUNT = 6

interface LayersPanelProps {
  pressureLevels: PressureLevel[]
  onPressureLevelChange: (levels: PressureLevel[]) => void
  contours: boolean
  onContoursChange: (enabled: boolean) => void
  hasImportedGrids: boolean
  smoothImportedGrids: boolean
  onSmoothImportedGridsChange: (enabled: boolean) => void
  smoothImportedGridSigma: number
  onSmoothImportedGridSigmaChange: (value: number) => void
  selectedAttributionPalette: AttributionPresetColormap | null
  onAttributionPaletteChange: (palette: AttributionPresetColormap) => void
  selectedContourPalette: AttributionPresetColormap
  onContourPaletteChange: (palette: AttributionPresetColormap) => void
  hasCustomColorScheme?: boolean
  customColorScheme?: AttributionColorScheme
  availableLevelIds?: Set<string> | null
  globalOpacity: number
  onGlobalOpacityChange: (v: number) => void
  diverging: boolean
  signed: boolean
  onSignedChange: (enabled: boolean) => void
  canToggleSigned: boolean
}

export function LayersPanel({
  pressureLevels,
  onPressureLevelChange,
  contours,
  onContoursChange,
  hasImportedGrids,
  smoothImportedGrids,
  onSmoothImportedGridsChange,
  smoothImportedGridSigma,
  onSmoothImportedGridSigmaChange,
  selectedAttributionPalette,
  onAttributionPaletteChange,
  selectedContourPalette,
  onContourPaletteChange,
  hasCustomColorScheme = false,
  customColorScheme,
  availableLevelIds = null,
  globalOpacity,
  onGlobalOpacityChange,
  diverging,
  signed,
  onSignedChange,
  canToggleSigned,
}: LayersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAppearanceExpanded, setIsAppearanceExpanded] = useState(false)
  const [displaySmoothSigma, setDisplaySmoothSigma] = useState(smoothImportedGridSigma)
  const [displayGlobalOpacity, setDisplayGlobalOpacity] = useState(globalOpacity)
  const [displayOpacities, setDisplayOpacities] = useState<Record<string, number>>({})

  useEffect(() => {
    setDisplaySmoothSigma(smoothImportedGridSigma)
  }, [smoothImportedGridSigma])

  useEffect(() => {
    setDisplayGlobalOpacity(globalOpacity)
  }, [globalOpacity])

  const handleVisibilityToggle = (levelId: string) => {
    if (availableLevelIds && !availableLevelIds.has(levelId)) {
      return
    }

    onPressureLevelChange(
      pressureLevels.map((pl) => (pl.id === levelId ? { ...pl, visible: !pl.visible } : pl))
    )
  }

  const handleOpacityChange = (levelId: string, opacity: number) => {
    onPressureLevelChange(
      pressureLevels.map((pl) => (pl.id === levelId ? { ...pl, opacity } : pl))
    )
  }

  const handleOpacityPreviewChange = (levelId: string, value: readonly number[] | number) => {
    const val = Array.isArray(value) ? value[0] : value
    setDisplayOpacities((prev) => ({ ...prev, [levelId]: val }))
  }

  const handleOpacityCommit = (levelId: string, value: readonly number[] | number) => {
    const val = Array.isArray(value) ? value[0] : value
    setDisplayOpacities((prev) => {
      const next = { ...prev }
      delete next[levelId]
      return next
    })
    handleOpacityChange(levelId, val)
  }

  const isLevelAvailable = (level: PressureLevel) => !availableLevelIds || availableLevelIds.has(level.id)
  const visiblePressureLevels = pressureLevels.filter((level) => level.visible && isLevelAvailable(level))
  const availablePressureLevels = pressureLevels.filter(isLevelAvailable)
  const usesDenseLayerList = availablePressureLevels.length > DENSE_LAYER_COUNT
  const displayedPressureLevels = availablePressureLevels
  const visibleCount = displayedPressureLevels.filter((level) => level.visible && isLevelAvailable(level)).length
  const attributionPalettes = useMemo(
    () => orderedAttributionUiPalettes(diverging),
    [diverging]
  )
  const contourPalettes = useMemo(
    () => orderedContourPalettes(diverging, hasCustomColorScheme),
    [diverging, hasCustomColorScheme]
  )
  const renderDenseLayerList = (showOpacityControls: boolean, levels: PressureLevel[]) => (
    <div className="overflow-hidden">
      <div className={cn('overflow-y-auto border-t border-border/30', showOpacityControls ? 'max-h-72' : 'max-h-52')}>
        {levels.length === 0 ? (
          <div className="border-b border-border/30 px-2.5 py-2 text-xs text-muted-foreground">
            No active layers
          </div>
        ) : levels.map((level) => {
          const isAvailable = !availableLevelIds || availableLevelIds.has(level.id)
          const opacity = displayOpacities[level.id] ?? level.opacity

          return (
            <div
              key={level.id}
              className={cn(
                'border-b border-border/30 transition-colors duration-200',
                !isAvailable ? 'opacity-45' : 'hover:bg-secondary/20'
              )}
            >
              <button
                type="button"
                onClick={() => handleVisibilityToggle(level.id)}
                disabled={!isAvailable}
                title={level.label}
                className="flex min-h-8 w-full items-center gap-2 px-2 py-1.5 text-left transition-colors touch-manipulation disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full transition-colors',
                    !isAvailable
                      ? 'bg-border'
                      : level.visible
                        ? 'bg-primary'
                        : 'bg-muted-foreground/35'
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    level.visible && isAvailable ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {level.label}
                </span>
                {!isAvailable && (
                  <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                    no data
                  </span>
                )}
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                    !isAvailable
                      ? 'border-border bg-secondary/40 text-transparent'
                      : level.visible
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background/80 text-transparent'
                  )}
                  aria-hidden="true"
                >
                  <CheckIcon className="size-3" />
                </span>
              </button>
              {showOpacityControls && level.visible && isAvailable && (
                <div className="flex items-center gap-2 px-2 pb-2 pl-6">
                  <Slider
                    value={[opacity]}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => handleOpacityPreviewChange(level.id, v)}
                    onValueCommitted={(v) => handleOpacityCommit(level.id, v)}
                    className="min-w-0 flex-1 touch-manipulation"
                  />
                  <span className="w-8 shrink-0 text-right text-[10px] font-mono text-muted-foreground">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="shrink-0 bg-card/80 backdrop-blur-md rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors touch-manipulation"
      >
        <div className="flex items-center gap-2">
          <LayersIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Layers</span>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            {visibleCount}/{displayedPressureLevels.length}
          </span>
        </div>
        <ChevronIcon
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      <div className="border-t border-border/30">
        <div className={cn('px-4 pt-2 space-y-2', usesDenseLayerList ? 'pb-0' : 'pb-1')}>
          {hasImportedGrids && (
            <div className={cn('flex items-center justify-between', contours && 'opacity-50')}>
              <div className="flex items-center gap-2">
                <SmoothIcon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">Smooth</span>
              </div>
              <Switch
                checked={smoothImportedGrids}
                onCheckedChange={contours ? undefined : onSmoothImportedGridsChange}
                disabled={contours}
                aria-label="Toggle imported-grid smoothing"
              />
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setIsAppearanceExpanded(!isAppearanceExpanded)}
              className="w-full flex items-center justify-between rounded-sm py-0.5 transition-colors hover:text-foreground touch-manipulation"
              aria-expanded={isAppearanceExpanded}
            >
              <div className="flex items-center gap-2">
                <AppearanceIcon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">Appearance</span>
              </div>
              <ChevronIcon
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                  isAppearanceExpanded && 'rotate-180'
                )}
              />
            </button>

            <div
              className={cn(
                'overflow-hidden transition-all duration-300 ease-in-out',
                isAppearanceExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              )}
            >
              <div className="pt-2 pl-4 space-y-3">
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ContourIcon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">Contour lines</span>
                  </div>
                  <Switch
                    checked={contours}
                    onCheckedChange={onContoursChange}
                    aria-label="Toggle contour lines"
                  />
                </div>

                {canToggleSigned && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <SignedIcon className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-medium">Show signed values</span>
                    </div>
                    <Switch
                      checked={signed}
                      onCheckedChange={onSignedChange}
                      aria-label="Toggle signed values (off shows absolute magnitude)"
                    />
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium">Opacity</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {Math.round(displayGlobalOpacity * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[displayGlobalOpacity]}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => {
                      const val = Array.isArray(v) ? v[0] : v
                      setDisplayGlobalOpacity(val)
                      onGlobalOpacityChange(val)
                    }}
                    className="touch-manipulation"
                  />
                </div>

                {hasImportedGrids && (smoothImportedGrids || contours) && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium">Smooth intensity</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {displaySmoothSigma.toFixed(1)}
                      </span>
                    </div>
                    <Slider
                      value={[displaySmoothSigma]}
                      min={IMPORTED_GRID_SIGMA_MIN}
                      max={IMPORTED_GRID_SIGMA_MAX}
                      step={IMPORTED_GRID_SIGMA_STEP}
                      onValueChange={(v) => setDisplaySmoothSigma(Array.isArray(v) ? v[0] : v)}
                      onValueCommitted={(v) => onSmoothImportedGridSigmaChange(Array.isArray(v) ? v[0] : v)}
                      className="touch-manipulation"
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-muted-foreground">subtle</span>
                      <span className="text-[10px] text-muted-foreground">strong</span>
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-xs text-muted-foreground mb-1 block">Color palette</span>

                  {/* Contour-specific row — injected first when contours are on */}
                  {contours && (
                    <div className="-m-1 flex flex-wrap gap-1 p-1 pb-1.5 border-b border-border/30 mb-1.5">
                      {contourPalettes.map((palette) => (
                        <button
                          key={palette}
                          type="button"
                          onClick={() => onContourPaletteChange(palette)}
                          title={attributionPaletteLabel(palette, diverging)}
                          className={cn(
                            'h-5 w-12 rounded text-[9px] font-medium transition-all touch-manipulation overflow-hidden',
                            selectedContourPalette === palette
                              ? 'ring-2 ring-primary ring-offset-1 ring-offset-card'
                              : 'opacity-60 hover:opacity-90'
                          )}
                          style={{
                            background: palette === 'contour-custom'
                              ? customColorSchemeGradientCss(customColorScheme)
                              : attributionPaletteGradient(palette, diverging),
                          }}
                          aria-pressed={selectedContourPalette === palette}
                          aria-label={attributionPaletteLabel(palette, diverging)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Normal palette row — always present */}
                  <div className={cn('-m-1 flex flex-wrap gap-1 p-1 pb-3', contours && 'opacity-50')}>
                    {attributionPalettes.map((palette) => (
                      <button
                        key={palette}
                        type="button"
                        onClick={() => onAttributionPaletteChange(palette)}
                        title={attributionPaletteLabel(palette, diverging)}
                        className={cn(
                          'h-5 w-12 rounded text-[9px] font-medium transition-all touch-manipulation overflow-hidden',
                          selectedAttributionPalette === palette
                            ? 'ring-2 ring-primary ring-offset-1 ring-offset-card'
                            : 'opacity-60 hover:opacity-90'
                        )}
                        style={{ background: attributionPaletteGradient(palette, diverging) }}
                        aria-pressed={selectedAttributionPalette === palette}
                        aria-label={attributionPaletteLabel(palette, diverging)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out',
            isExpanded ? 'max-h-none opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className={cn('px-4 pb-4 space-y-3', usesDenseLayerList ? 'pt-1.5' : 'pt-2')}>
            {usesDenseLayerList ? (
              renderDenseLayerList(true, displayedPressureLevels)
            ) : (
              <div className="space-y-3">
                {availablePressureLevels.map((level) => {
                  const isAvailable = true
                  return (
                    <div
                      key={level.id}
                      className={cn(
                        'p-3 rounded-md transition-all duration-200',
                        !isAvailable
                          ? 'bg-secondary/10 opacity-40'
                          : level.visible ? 'bg-secondary/50' : 'bg-secondary/20 opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={level.visible}
                            onCheckedChange={() => handleVisibilityToggle(level.id)}
                            disabled={!isAvailable}
                            aria-label={`Toggle ${level.label} visibility`}
                          />
                          <div>
                            <span className="text-sm font-medium">{level.label}</span>
                            {!isAvailable && <span className="text-xs text-muted-foreground ml-2">no data</span>}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">
                          {Math.round((displayOpacities[level.id] ?? level.opacity) * 100)}%
                        </span>
                      </div>
                      {level.visible && isAvailable && (
                        <div className="pl-8">
                          <Slider
                            value={[displayOpacities[level.id] ?? level.opacity]}
                            min={0.1}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => handleOpacityPreviewChange(level.id, v)}
                            onValueCommitted={(v) => handleOpacityCommit(level.id, v)}
                            className="touch-manipulation"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {!isExpanded && (
          usesDenseLayerList ? (
            <div className="px-4 pb-3 pt-1.5">
              {renderDenseLayerList(false, visiblePressureLevels)}
            </div>
          ) : (
            <div className="px-4 pb-3 pt-2 flex flex-wrap gap-1.5">
              {availablePressureLevels.map((level) => (
                <button
                  key={level.id}
                  onClick={() => handleVisibilityToggle(level.id)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-all touch-manipulation',
                    level.visible
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-secondary text-muted-foreground border border-transparent'
                  )}
                  style={{ opacity: level.visible ? level.opacity * 0.5 + 0.5 : 0.5 }}
                >
                  {level.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ContourIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5c4.7 0 8.5 3 8.5 7s-3.4 8-8.5 8-8.5-3.6-8.5-7.6S7.3 4.5 12 4.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12.3 8c2.9 0 5.2 1.7 5.2 4s-2.1 4.6-5.2 4.6-5.4-2-5.4-4.3S9.4 8 12.3 8z" />
      <ellipse cx="12.4" cy="12.3" rx="2.1" ry="1.7" />
    </svg>
  )
}

function SignedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h6M7 5v6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 17h6" />
    </svg>
  )
}

function AppearanceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3.5a8.5 8.5 0 0 0 0 17h1.15a1.85 1.85 0 0 0 1.25-3.22 1.3 1.3 0 0 1 .88-2.25h1.09A4.13 4.13 0 0 0 20.5 10.9C20.5 6.84 16.7 3.5 12 3.5Zm-4.45 8.35a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm2.4-3.9a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4.1 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm2.4 3.9a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  )
}

function SmoothIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9c1.5-2 3-3 4.5-3S11.5 7 13 9s3 3 4.5 3S20.5 11 22 9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 15c1.5-2 3-3 4.5-3S9.5 13 11 15s3 3 4.5 3S18.5 17 20 15" />
    </svg>
  )
}
