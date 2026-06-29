import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { type OverlayColormap, type OverlayData, type OverlayLayerState } from '@/types'
import { OVERLAY_COLORMAP_LABELS, overlayGradientCss } from '@/lib/overlayColor'

interface OverlayPanelProps {
  overlays: Record<string, OverlayData>
  overlayStates: OverlayLayerState[]
  onOverlayStatesChange: (states: OverlayLayerState[]) => void
}

function formatValue(val: number): string {
  if (Math.abs(val) >= 1000 || (Math.abs(val) < 0.001 && val !== 0)) {
    return val.toExponential(2)
  }
  if (Number.isInteger(val)) return String(val)
  return val.toPrecision(3)
}

/**
 * Build the overlay time annotation, e.g. "Aurora input step t0 · 6 h before
 * this frame" (or "Forecast valid time t2 · 6 h after this frame" for a
 * positive offset). The label and the offset clause are each optional: a missing
 * label drops the "[text] ·" prefix, a zero/missing offset drops the clause,
 * and when both are absent the whole line is hidden (returns null).
 */
function formatTimeAnnotation(offsetHours?: number, label?: string): string | null {
  const parts: string[] = []
  if (label) parts.push(label)
  if (typeof offsetHours === 'number' && Number.isFinite(offsetHours) && offsetHours !== 0) {
    const abs = Math.abs(offsetHours)
    const dir = offsetHours < 0 ? 'before' : 'after'
    parts.push(`${abs} h ${dir} this frame`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

type StretchState = { low: number; high: number }

export function OverlayPanel({ overlays, overlayStates, onOverlayStatesChange }: OverlayPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [displayOpacities, setDisplayOpacities] = useState<Record<string, number>>({})
  // Local in-drag stretch state (mirrors committed state; committed on pointer-up)
  const [displayStretches, setDisplayStretches] = useState<Record<string, StretchState>>({})
  const draggingRef = useRef<{
    slug: string
    handle: 'low' | 'high'
    pointerId: number
    latest: StretchState
  } | null>(null)
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // Fires after the pointer leaves the track during a drag: auto-commit + end drag.
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slugs = Object.keys(overlays)
  if (slugs.length === 0) return null

  const stateBySlug = new Map(overlayStates.map((s) => [s.slug, s]))

  function getState(slug: string): OverlayLayerState {
    return stateBySlug.get(slug) ?? {
      slug,
      visible: true,
      opacity: 0.7,
      colormap: overlays[slug]?.colormap ?? 'viridis',
      stretchLow: 0,
      stretchHigh: 1,
    }
  }

  function getStretch(slug: string): StretchState {
    if (displayStretches[slug] !== undefined) return displayStretches[slug]
    const s = getState(slug)
    return { low: s.stretchLow, high: s.stretchHigh }
  }

  // Grace period after the pointer leaves the track before the drag auto-stops.
  const DRAG_LEAVE_TIMEOUT_MS = 220
  // Slack around the track so small overshoots (esp. vertically on the thin bar)
  // don't count as "left the element".
  const DRAG_LEAVE_MARGIN_PX = 24

  function clearLeaveTimer() {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }

  // End the active drag and commit its current position to persistent state.
  function commitDrag(slug: string) {
    const drag = draggingRef.current
    if (!drag || drag.slug !== slug) return
    const { low, high } = drag.latest
    draggingRef.current = null
    clearLeaveTimer()
    const track = trackRefs.current[slug]
    if (track) {
      try { track.releasePointerCapture(drag.pointerId) } catch { /* already released */ }
    }
    updateState(slug, { stretchLow: low, stretchHigh: high })
    setDisplayStretches((prev) => { const n = { ...prev }; delete n[slug]; return n })
  }

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>, slug: string) {
    e.preventDefault()
    const track = trackRefs.current[slug]
    if (!track) return
    const rect = track.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const { low, high } = getStretch(slug)
    const handle: 'low' | 'high' = Math.abs(frac - low) <= Math.abs(frac - high) ? 'low' : 'high'
    clearLeaveTimer()
    draggingRef.current = { slug, handle, pointerId: e.pointerId, latest: { low, high } }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }

  function onTrackPointerMove(e: React.PointerEvent<HTMLDivElement>, slug: string) {
    const drag = draggingRef.current
    if (!drag || drag.slug !== slug) return
    const track = trackRefs.current[slug]
    if (!track) return
    const rect = track.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const current = getStretch(slug)
    const MIN_GAP = 0.02
    let next: StretchState
    if (drag.handle === 'low') {
      next = { low: Math.min(frac, current.high - MIN_GAP), high: current.high }
    } else {
      next = { low: current.low, high: Math.max(frac, current.low + MIN_GAP) }
    }
    drag.latest = next
    setDisplayStretches((prev) => ({ ...prev, [slug]: next }))

    // Pointer capture keeps move events flowing even outside the bar; if the
    // pointer has left the track, arm a timer to auto-stop the drag.
    const inside =
      e.clientX >= rect.left - DRAG_LEAVE_MARGIN_PX &&
      e.clientX <= rect.right + DRAG_LEAVE_MARGIN_PX &&
      e.clientY >= rect.top - DRAG_LEAVE_MARGIN_PX &&
      e.clientY <= rect.bottom + DRAG_LEAVE_MARGIN_PX
    if (inside) {
      clearLeaveTimer()
    } else if (leaveTimerRef.current === null) {
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null
        commitDrag(slug)
      }, DRAG_LEAVE_TIMEOUT_MS)
    }
  }

  function onTrackPointerUp(_e: React.PointerEvent<HTMLDivElement>, slug: string) {
    commitDrag(slug)
  }

  function onTrackDoubleClick(slug: string) {
    updateState(slug, { stretchLow: 0, stretchHigh: 1 })
    setDisplayStretches((prev) => { const n = { ...prev }; delete n[slug]; return n })
  }

  function updateState(slug: string, patch: Partial<OverlayLayerState>) {
    const next = slugs.map((s) => ({ ...getState(s), ...(s === slug ? patch : {}) }))
    onOverlayStatesChange(next)
  }

  function displayColormaps(overlayData: OverlayData): OverlayColormap[] {
    return ['viridis', 'plasma', overlayData.colormapStops ? 'custom' : 'sequential']
  }

  const visibleCount = slugs.filter((s) => getState(s).visible).length

  return (
    <div className="shrink-0 bg-card/80 backdrop-blur-md rounded-lg border border-border/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors touch-manipulation"
      >
        <div className="flex items-center gap-2">
          <LayersOverlayIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Overlays</span>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            {visibleCount}/{slugs.length}
          </span>
        </div>
        <ChevronIcon
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded: per-overlay rows */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-none opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="px-4 pb-4 pt-1 space-y-3">
          {slugs.map((slug) => {
            const overlayData = overlays[slug]
            const state = getState(slug)
            const displayOpacity = displayOpacities[slug] ?? state.opacity

            return (
              <div
                key={slug}
                className={cn(
                  'p-3 rounded-md transition-all duration-200',
                  state.visible ? 'bg-secondary/50' : 'bg-secondary/20 opacity-60',
                )}
              >
                {/* Row 1: toggle + name + unit */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={state.visible}
                      onCheckedChange={(v) => updateState(slug, { visible: v })}
                      aria-label={`Toggle ${overlayData.label} visibility`}
                    />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{overlayData.label}</span>
                      {overlayData.unit && (
                        <span className="text-xs text-muted-foreground">{overlayData.unit}</span>
                      )}
                      {(() => {
                        const annotation = formatTimeAnnotation(overlayData.timeOffsetHours, overlayData.timeLabel)
                        return annotation ? (
                          <span className="text-[10px] text-muted-foreground/80 truncate block" title={annotation}>
                            {annotation}
                          </span>
                        ) : null
                      })()}
                    </div>
                  </div>
                </div>

                {state.visible && (
                  <>
                    {/* Opacity slider */}
                    <div className="pl-8 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Opacity</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {Math.round(displayOpacity * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[displayOpacity]}
                        min={0.05}
                        max={1}
                        step={0.05}
                        onValueChange={(v) =>
                          setDisplayOpacities((prev) => ({
                            ...prev,
                            [slug]: Array.isArray(v) ? v[0] : v,
                          }))
                        }
                        onValueCommitted={(v) =>
                          updateState(slug, { opacity: Array.isArray(v) ? v[0] : v })
                        }
                        className="touch-manipulation"
                      />
                    </div>

                    {/* Colormap chip row */}
                    <div className="pl-8">
                      <span className="text-xs text-muted-foreground mb-1 block">Colormap</span>
                      <div className="flex gap-1 flex-wrap">
                        {displayColormaps(overlayData).map((cm) => (
                          <button
                            key={cm}
                            onClick={() => updateState(slug, { colormap: cm })}
                            title={OVERLAY_COLORMAP_LABELS[cm]}
                            className={cn(
                              'h-5 w-12 rounded text-[9px] font-medium transition-all touch-manipulation overflow-hidden',
                              state.colormap === cm
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-card'
                                : 'opacity-60 hover:opacity-90',
                            )}
                            style={{ background: overlayGradientCss(cm, overlayData.colormapStops) }}
                            aria-pressed={state.colormap === cm}
                            aria-label={OVERLAY_COLORMAP_LABELS[cm]}
                          />
                        ))}
                      </div>
                      {/* Colormap gradient legend bar — drag handles to stretch contrast, double-click to reset */}
                      {(() => {
                        const { low, high } = getStretch(slug)
                        const range = overlayData.maxVal - overlayData.minVal
                        const dispMin = formatValue(overlayData.minVal + low  * range)
                        const dispMax = formatValue(overlayData.minVal + high * range)
                        return (
                          <>
                            <div
                              ref={(el) => { trackRefs.current[slug] = el }}
                              className="mt-2 relative cursor-col-resize select-none touch-manipulation"
                              style={{ height: 20 }}
                              onPointerDown={(e) => onTrackPointerDown(e, slug)}
                              onPointerMove={(e) => onTrackPointerMove(e, slug)}
                              onPointerUp={(e) => onTrackPointerUp(e, slug)}
                              onPointerCancel={(e) => onTrackPointerUp(e, slug)}
                              onDoubleClick={() => onTrackDoubleClick(slug)}
                              title="Drag handles to stretch contrast · Double-click to reset"
                            >
                              {/* Gradient track, vertically centred */}
                              <div className="absolute rounded" style={{ left: 0, right: 0, top: '50%', height: 6, transform: 'translateY(-50%)', background: overlayGradientCss(state.colormap, overlayData.colormapStops) }}>
                                {/* Dim overlay on the left of low handle */}
                                <div style={{ position: 'absolute', inset: 0, right: `${(1 - low) * 100}%`, background: 'rgba(0,0,0,0.55)', borderRadius: 'inherit' }} />
                                {/* Dim overlay on the right of high handle */}
                                <div style={{ position: 'absolute', inset: 0, left: `${high * 100}%`, background: 'rgba(0,0,0,0.55)', borderRadius: 'inherit' }} />
                              </div>
                              {/* Low handle — round thumb */}
                              <div style={{ position: 'absolute', top: '50%', left: `${low * 100}%`, width: 12, height: 12, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.4)', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' }} />
                              {/* High handle — round thumb */}
                              <div style={{ position: 'absolute', top: '50%', left: `${high * 100}%`, width: 12, height: 12, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.4)', transform: 'translate(-50%, -50%)', cursor: 'ew-resize' }} />
                            </div>
                            <div className="flex justify-between mt-0.5">
                              <span className="text-[10px] text-muted-foreground font-mono">{dispMin}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{dispMax}</span>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Collapsed: quick visibility chips */}
      {!isExpanded && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {slugs.map((slug) => {
            const state = getState(slug)
            return (
              <button
                key={slug}
                onClick={() => updateState(slug, { visible: !state.visible })}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-all touch-manipulation max-w-32 truncate',
                  state.visible
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'bg-secondary text-muted-foreground border border-transparent',
                )}
                style={{ opacity: state.visible ? state.opacity * 0.5 + 0.5 : 0.5 }}
                title={overlays[slug]?.label}
              >
                {overlays[slug]?.label ?? slug}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LayersOverlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 17l10 5 10-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 12l10 5 10-5" />
      <circle cx="19" cy="5" r="3" fill="currentColor" strokeWidth={0} className="text-primary" />
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
