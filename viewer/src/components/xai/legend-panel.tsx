import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { attributionPaletteGradient, attributionPaletteLabel, attributionRampStops } from '@/lib/attributionColor'
import { OVERLAY_COLORMAP_LABELS, overlayGradientCss } from '@/lib/overlayColor'
import {
  type AttributionColorScheme,
  type AttributionColorStop,
  type OverlayData,
  type OverlayLayerState,
} from '@/types'

interface LegendPanelProps {
  attributionColorScheme: AttributionColorScheme
  diverging: boolean
  contours?: boolean
  methodLabel?: string
  /**
   * Raw-value magnitude the colormap end corresponds to under the current
   * normalization scope; null renders the relative −1…+1 (or 0…1) labels.
   */
  attributionMaxAbs?: number | null
  overlays?: Record<string, OverlayData>
  overlayStates: OverlayLayerState[]
}

function sampleStopColor(stops: AttributionColorStop[], t: number): string {
  if (stops.length === 0) return 'rgb(128 128 128)'
  if (stops.length === 1) return rgbCss(stops[0].color)
  const sorted = [...stops].sort((a, b) => a.position - b.position)
  if (t <= sorted[0].position) return rgbCss(sorted[0].color)
  if (t >= sorted[sorted.length - 1].position) return rgbCss(sorted[sorted.length - 1].color)
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].position && t <= sorted[i + 1].position) {
      const f = (t - sorted[i].position) / (sorted[i + 1].position - sorted[i].position)
      const c = sorted[i].color.map((v, j) => v + f * (sorted[i + 1].color[j] - v)) as [number, number, number]
      return rgbCss(c)
    }
  }
  return 'rgb(128 128 128)'
}

function ContourLegendPreview({
  scheme,
  diverging,
}: {
  scheme: AttributionColorScheme
  diverging: boolean
}) {
  const stops = attributionRampStops(scheme, diverging)
  const LINE_COUNT = 7
  // t values evenly across [0, 1]; for diverging we skip the very center (zero line is invisible)
  const tValues = Array.from({ length: LINE_COUNT }, (_, i) => i / (LINE_COUNT - 1))

  return (
    <div>
      <svg
        viewBox={`0 0 120 ${LINE_COUNT * 4 - 2}`}
        preserveAspectRatio="none"
        width="100%"
        height={LINE_COUNT * 4 - 2}
        className="block overflow-visible"
        aria-hidden="true"
      >
        {tValues.map((t, i) => {
          const color = sampleStopColor(stops, t)
          // opacity: for diverging, lines near 0.5 (zero) fade out; for sequential, low-t lines fade
          const dist = diverging ? Math.abs(t - 0.5) * 2 : t
          const opacity = 0.18 + 0.82 * Math.pow(dist, 0.6)
          // line weight: extreme values slightly heavier
          const strokeWidth = 0.9 + 0.6 * Math.pow(dist, 1.2)
          const y = i * 4 + 0.5
          return (
            <line
              key={i}
              x1="0" y1={y} x2="120" y2={y}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeOpacity={opacity}
              strokeLinecap="round"
            />
          )
        })}
      </svg>
      <div className="mt-1.5 grid grid-cols-3 text-[10px] font-mono tabular-nums text-muted-foreground">
        <span>{diverging ? '−' : 'min'}</span>
        <span className={cn('text-center', !diverging && 'opacity-0')} aria-hidden={!diverging}>
          {diverging ? '0' : ''}
        </span>
        <span className="text-right">{diverging ? '+' : 'max'}</span>
      </div>
    </div>
  )
}

function formatValue(val: number): string {
  if (Math.abs(val) >= 1000 || (Math.abs(val) < 0.001 && val !== 0)) {
    return val.toExponential(2)
  }
  if (Number.isInteger(val)) return String(val)
  return val.toPrecision(3)
}

function rgbCss(color: [number, number, number]): string {
  return `rgb(${color.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255)).join(' ')})`
}

function attributionGradientCss(scheme: AttributionColorScheme, diverging: boolean): string {
  if (scheme.type === 'preset') return attributionPaletteGradient(scheme.name, diverging)
  if (scheme.stops.length === 0) return attributionPaletteGradient('default', diverging)
  const parts = scheme.stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${rgbCss(s.color)} ${Math.round(Math.max(0, Math.min(1, s.position)) * 100)}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

function attributionLabel(scheme: AttributionColorScheme, diverging: boolean): string {
  return scheme.type === 'preset'
    ? attributionPaletteLabel(scheme.name, diverging)
    : 'Custom'
}

export function LegendPanel({
  attributionColorScheme,
  diverging,
  contours = false,
  attributionMaxAbs = null,
  overlays,
  overlayStates,
}: LegendPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasMaxAbs = typeof attributionMaxAbs === 'number' && attributionMaxAbs > 0
  const legendMin = hasMaxAbs
    ? (diverging ? `−${formatValue(attributionMaxAbs)}` : '0')
    : (diverging ? '−1' : '0')
  const legendMax = hasMaxAbs
    ? (diverging ? `+${formatValue(attributionMaxAbs)}` : formatValue(attributionMaxAbs))
    : (diverging ? '+1' : '1')

  const overlayEntries = Object.entries(overlays ?? {}).filter(([slug]) =>
    overlayStates.find((s) => s.slug === slug)?.visible ?? overlays?.[slug]?.visible ?? true
  )
  const hasOverlays = overlayEntries.length > 0

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/85 shadow-md backdrop-blur-md">
      {/* Attribution — always visible */}
      <div className="px-3.5 pt-2.5 pb-2.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {contours ? 'Isolines' : 'Attribution'}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {attributionLabel(attributionColorScheme, diverging)}
          </span>
        </div>

        {contours ? (
          <ContourLegendPreview scheme={attributionColorScheme} diverging={diverging} />
        ) : (
          <>
            <div
              className="h-2 rounded-full ring-1 ring-border/40"
              style={{ background: attributionGradientCss(attributionColorScheme, diverging) }}
            />
            <div className="mt-1 grid grid-cols-3 text-[10px] font-mono tabular-nums text-muted-foreground">
              <span>{legendMin}</span>
              <span className={cn('text-center', !diverging && 'opacity-0')} aria-hidden={!diverging}>
                0
              </span>
              <span className="text-right">{legendMax}</span>
            </div>
          </>
        )}
      </div>

      {/* Overlays — toggle + per-overlay scale */}
      {hasOverlays && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between border-t border-border/40 px-3.5 py-1.5 transition-colors hover:bg-secondary/30 touch-manipulation"
            aria-expanded={isExpanded}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Overlays
            </span>
            <ChevronDownIcon
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                isExpanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          <div
            className={cn(
              'overflow-hidden transition-all duration-300 ease-in-out',
              isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
            )}
          >
            {overlayEntries.map(([slug, overlay], i) => {
              const state = overlayStates.find((s) => s.slug === slug)
              const colormap = state?.colormap ?? overlay.colormap
              const low = state?.stretchLow ?? 0
              const high = state?.stretchHigh ?? 1
              const range = overlay.maxVal - overlay.minVal
              const min = overlay.minVal + low * range
              const max = overlay.minVal + high * range

              return (
                <div
                  key={slug}
                  className={cn('px-3.5 py-2.5', i > 0 && 'border-t border-border/30')}
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-medium text-foreground">
                      {overlay.label}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {OVERLAY_COLORMAP_LABELS[colormap]}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full ring-1 ring-border/40"
                    style={{ background: overlayGradientCss(colormap, overlay.colormapStops) }}
                  />
                  <div className="mt-1 grid grid-cols-3 text-[10px] font-mono tabular-nums text-muted-foreground">
                    <span>{formatValue(min)}</span>
                    <span className={cn('text-center', !overlay.unit && 'opacity-0')} aria-hidden={!overlay.unit}>
                      {overlay.unit || 'none'}
                    </span>
                    <span className="text-right">{formatValue(max)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
