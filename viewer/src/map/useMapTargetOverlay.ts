import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { normalizeTargetColor, targetSignature } from '@/lib/targets'
import type { ViewerTarget } from '@/types'
import { refreshTargetSvg } from './targetSvgOverlay'

interface MapTargetOverlayParams {
  mapRef: RefObject<maplibregl.Map | null>
  mapReady: boolean
  target: ViewerTarget | null
  targetColor: string
  blendMs: number
}

/**
 * Draws and animates the target box/point as an SVG overlay on top of the
 * MapLibre canvas. Owns the SVG element refs and the target-tracking refs, and
 * exposes:
 *  - `svgGroupRef` / `svgBoxRef` / `svgPointRef` to attach to the `<svg>` markup
 *  - `refreshTargetOverlay()` to re-project on map move / camera flights
 *  - `resetTarget()` to cancel any in-flight fade and clear the tracked target
 *    (call on map (re)creation and teardown)
 */
export function useMapTargetOverlay({ mapRef, mapReady, target, targetColor, blendMs }: MapTargetOverlayParams) {
  const targetColorRef = useRef(targetColor)
  const currentTargetRef = useRef<ViewerTarget | null>(null)
  const targetKeyRef = useRef('none')
  const targetBlendRafRef = useRef(0)
  const svgOpacityRef = useRef(0)

  // SVG overlay element refs (direct DOM manipulation — no React re-renders on map move)
  const svgGroupRef = useRef<SVGGElement | null>(null)
  const svgBoxRef = useRef<SVGPathElement | null>(null)
  const svgPointRef = useRef<SVGCircleElement | null>(null)

  // Mirror the latest target color into a ref so the long-lived map 'move'
  // handler always reads the current value without re-registering.
  useEffect(() => {
    targetColorRef.current = targetColor
  })

  /** Re-project the currently tracked target onto the SVG overlay. */
  const refreshTargetOverlay = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    refreshTargetSvg(
      map,
      currentTargetRef.current,
      svgBoxRef.current,
      svgPointRef.current,
      normalizeTargetColor(targetColorRef.current),
    )
  }, [mapRef])

  /** Cancel any in-flight fade and clear the tracked target. */
  const resetTarget = useCallback(() => {
    if (targetBlendRafRef.current) {
      cancelAnimationFrame(targetBlendRafRef.current)
      targetBlendRafRef.current = 0
    }
    targetKeyRef.current = 'none'
    currentTargetRef.current = null
  }, [])

  // Sync SVG target color when prop changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !currentTargetRef.current) return
    const color = normalizeTargetColor(targetColor)
    refreshTargetSvg(
      map,
      currentTargetRef.current,
      svgBoxRef.current,
      svgPointRef.current,
      color,
    )
  }, [mapRef, mapReady, targetColor])

  // Handle target changes: update SVG content + fade in/out
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const nextTarget = target ?? null
    const nextKey = targetSignature(nextTarget)
    if (nextKey === targetKeyRef.current) return
    targetKeyRef.current = nextKey

    currentTargetRef.current = nextTarget

    // Update SVG geometry for the new target immediately
    refreshTargetSvg(
      map,
      nextTarget,
      svgBoxRef.current,
      svgPointRef.current,
      normalizeTargetColor(targetColorRef.current),
    )

    if (targetBlendRafRef.current) {
      cancelAnimationFrame(targetBlendRafRef.current)
      targetBlendRafRef.current = 0
    }

    const duration = Math.max(0, blendMs)
    const startOpacity = svgOpacityRef.current
    const endOpacity = nextTarget ? 1 : 0
    const startTime = performance.now()

    const animate = () => {
      const t = duration <= 0 ? 1 : Math.min((performance.now() - startTime) / duration, 1)
      const opacity = startOpacity + (endOpacity - startOpacity) * t
      svgOpacityRef.current = opacity
      if (svgGroupRef.current) {
        svgGroupRef.current.style.opacity = String(opacity)
      }
      if (t < 1) {
        targetBlendRafRef.current = requestAnimationFrame(animate)
      } else {
        targetBlendRafRef.current = 0
      }
    }
    animate()
  }, [mapRef, blendMs, mapReady, target])

  return { svgGroupRef, svgBoxRef, svgPointRef, refreshTargetOverlay, resetTarget }
}
