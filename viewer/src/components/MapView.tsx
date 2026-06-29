/**
 * 2D MapLibre view with the volumetric attribution overlay.
 *
 * - Displays ArcGIS raster tiles (satellite / topo) via two MapLibre sources
 *   with visibility toggling (no flicker on switch)
 * - Installs VolumeOverlayLayer after map load; layer reads from the shared
 *   VolumeCache so no redundant builds happen when switching globe ↔ map
 * - Responds to external mapZoom changes (zoom buttons) via flyTo
 * - Reports scroll/pinch zoom back to App as a display multiplier
 * - Target box/point is drawn as an SVG overlay positioned on top of the canvas
 */

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DEFAULT_TARGET_COLOR } from '@/lib/targets'
import { DEFAULT_ATTRIBUTION_COLOR_SCHEME } from '@/lib/attributionColor'
import type { AttributionColorScheme, AttributionPoint, DenseLevelGrid, GlobeMapType, OverlayData, OverlayLayerState, PressureLevel, ViewerTarget } from '@/types'
import type { VolumeCache } from '@/globe/volumeCache'
import { createVolumeOverlayLayer } from '@/map/VolumeOverlayLayer'
import { createOverlaysLayer } from '@/map/OverlayLayer'
import { useMapTargetOverlay } from '@/map/useMapTargetOverlay'
import { BasemapAttribution } from './BasemapAttribution'

// Tile templates (ArcGIS — same origins as globe renderer)
const TILE_URLS: Record<GlobeMapType, string> = {
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  //topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
  topo: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
}

/** Default zoom (~ global overview). Buttons delta from this baseline. */
export const DEFAULT_MAP_ZOOM = 1.5

interface MapViewProps {
  volumeCache: VolumeCache
  points: AttributionPoint[]
  pressureLevels: PressureLevel[]
  mapType: GlobeMapType
  frameKey: string
  blendMs: number
  smoothImportedGrids: boolean
  smoothImportedGridSigma: number
  mapZoom: number
  /** Called with display multiplier (= 2^(zoom - DEFAULT_MAP_ZOOM)). */
  onZoomChange: (zoomMultiplier: number) => void
  target?: ViewerTarget | null
  targetColor?: string
  nextFrameKey?: string
  nextPoints?: AttributionPoint[]
  nextExternalGrids?: Record<string, DenseLevelGrid> | null
  initialCenter?: [number, number]
  initialZoom?: number
  onViewChange?: (lng: number, lat: number, zoom: number, pitch: number) => void
  /** Repeated camera moves are keyed by id so identical positions still run. */
  requestedView?: { lng: number; lat: number; zoom: number; durationMs: number; id: number }
  /** Dense grids bypass the sparse-points volume path when present. */
  externalGrids?: Record<string, DenseLevelGrid> | null
  diverging?: boolean
  absolute?: boolean
  colorScheme?: AttributionColorScheme
  contours?: boolean
  /** Triggers map.resize() after returning from display:none. */
  isVisible?: boolean
  overlays?: Record<string, OverlayData> | null
  overlayStates?: OverlayLayerState[]
  overlayFrameIndex?: number
  globalOpacity?: number
  /** Reports when the map is ready for screenshot capture. */
  onReadyChange?: (ready: boolean) => void
}

export default function MapView({
  volumeCache,
  points,
  pressureLevels,
  mapType,
  frameKey,
  blendMs,
  smoothImportedGrids,
  smoothImportedGridSigma,
  mapZoom,
  onZoomChange,
  target = null,
  targetColor = DEFAULT_TARGET_COLOR,
  nextFrameKey,
  nextPoints,
  nextExternalGrids,
  externalGrids,
  diverging = false,
  absolute = false,
  colorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME,
  contours = false,
  initialCenter,
  initialZoom,
  onViewChange,
  requestedView,
  isVisible = true,
  overlays,
  overlayStates = [],
  overlayFrameIndex = 0,
  globalOpacity = 1,
  onReadyChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapLoadedRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)

  // SVG target overlay (owns its element refs, fade animation, and color sync).
  const { svgGroupRef, svgBoxRef, svgPointRef, refreshTargetOverlay, resetTarget } =
    useMapTargetOverlay({ mapRef, mapReady, target, targetColor, blendMs })

  // Stable refs so the overlay layer closure always sees the latest values
  const frameKeyRef       = useRef(frameKey)
  const pointsRef         = useRef(points)
  const pressureLevelsRef = useRef(pressureLevels)
  const blendMsRef        = useRef(blendMs)
  const smoothImportedGridsRef = useRef(smoothImportedGrids)
  const smoothImportedGridSigmaRef = useRef(smoothImportedGridSigma)
  const nextFrameKeyRef   = useRef(nextFrameKey)
  const nextPointsRef     = useRef(nextPoints)
  const nextExternalGridsRef = useRef(nextExternalGrids)
  const externalGridsRef  = useRef(externalGrids)
  const divergingRef      = useRef(diverging)
  const absoluteRef       = useRef(absolute)
  const colorSchemeRef    = useRef(colorScheme)
  const contoursRef       = useRef(contours)
  const globalOpacityRef  = useRef(globalOpacity)
  const onZoomChangeRef   = useRef(onZoomChange)
  const onViewChangeRef   = useRef(onViewChange)
  const onReadyChangeRef  = useRef(onReadyChange)
  const initialCenterRef  = useRef(initialCenter)
  const initialZoomRef    = useRef(initialZoom)
  const overlaysRef       = useRef(overlays)
  const overlayStatesRef  = useRef(overlayStates)
  const overlayFrameIndexRef = useRef(overlayFrameIndex)
  const requestedViewRef  = useRef(requestedView)

  // Mirror the latest props into refs after every commit so the map's
  // long-lived event handlers and async callbacks always read current values.
  // These refs are only read inside effects/callbacks (never during render), so
  // updating them in a passive effect is equivalent to writing during render.
  useEffect(() => {
    frameKeyRef.current       = frameKey
    pointsRef.current         = points
    pressureLevelsRef.current = pressureLevels
    blendMsRef.current        = blendMs
    smoothImportedGridsRef.current = smoothImportedGrids
    smoothImportedGridSigmaRef.current = smoothImportedGridSigma
    nextFrameKeyRef.current   = nextFrameKey
    nextPointsRef.current     = nextPoints
    nextExternalGridsRef.current = nextExternalGrids
    externalGridsRef.current  = externalGrids
    divergingRef.current      = diverging
    absoluteRef.current       = absolute
    colorSchemeRef.current    = colorScheme
    contoursRef.current       = contours
    globalOpacityRef.current  = globalOpacity
    onZoomChangeRef.current   = onZoomChange
    onViewChangeRef.current   = onViewChange
    onReadyChangeRef.current  = onReadyChange
    overlaysRef.current       = overlays
    overlayStatesRef.current  = overlayStates
    overlayFrameIndexRef.current = overlayFrameIndex
    requestedViewRef.current  = requestedView
  })

  // Create map once on mount (volumeCache is stable for the app lifetime)
  useEffect(() => {
    if (!containerRef.current) return

    // If the map is recreated, mark capture as not ready until load/idle settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapReady(false)
    onReadyChangeRef.current?.(false)
    let readyTimeout: ReturnType<typeof setTimeout> | undefined
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: [TILE_URLS.satellite],
            tileSize: 256,
            attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, GIS User Community',
          },
          topo: {
            type: 'raster',
            tiles: [TILE_URLS.topo],
            tileSize: 256,
            attribution: 'Basemap: CARTO | OpenStreetMap contributors',
          },
        },
        layers: [
          // Initial visibility matches App's default mapType = 'topo'
          { id: 'satellite-layer', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
          { id: 'topo-layer',      type: 'raster', source: 'topo',      layout: { visibility: 'visible' } },
        ],
      },
      center: initialCenterRef.current ?? [10, 47],
      zoom: initialZoomRef.current ?? DEFAULT_MAP_ZOOM,
      pitch: 0,
      attributionControl: false,
      dragRotate: false,
      maxPitch: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })

    const markReady = () => {
      if (mapRef.current !== map) return
      requestAnimationFrame(() => {
        if (mapRef.current !== map) return
        setMapReady(true)
        onReadyChangeRef.current?.(true)
      })
    }

    map.on('load', () => {
      mapLoadedRef.current = true

      // Install volume overlay
      const overlay = createVolumeOverlayLayer({
        volumeCache,
        getFrameKey:      () => frameKeyRef.current,
        getPoints:        () => pointsRef.current,
        getPressureLevels: () => pressureLevelsRef.current,
        getBlendMs:       () => blendMsRef.current,
        getNextFrameKey:  () => nextFrameKeyRef.current,
        getNextPoints:    () => nextPointsRef.current ?? undefined,
        getNextExternalGrids: () => nextExternalGridsRef.current,
        getSmoothImportedGrids: () => smoothImportedGridsRef.current,
        getSmoothImportedGridSigma: () => smoothImportedGridSigmaRef.current,
        getExternalGrids: () => externalGridsRef.current,
        getDiverging:     () => divergingRef.current,
        getAbsolute:      () => absoluteRef.current,
        getColorScheme:   () => colorSchemeRef.current,
        getContours:      () => contoursRef.current,
        getGlobalOpacity: () => globalOpacityRef.current,
      })
      map.addLayer(overlay)

      // Install weather-field overlay layer (rendered on top of volume overlay)
      const overlayLayer = createOverlaysLayer({
        getOverlays:       () => overlaysRef.current,
        getOverlayStates:  () => overlayStatesRef.current,
        getFrameIndex:     () => overlayFrameIndexRef.current,
        getBlendMs:        () => blendMsRef.current,
      })
      map.addLayer(overlayLayer)

      resetTarget()
      map.once('idle', markReady)
      readyTimeout = setTimeout(markReady, 1800)

      // Apply any camera view that was requested before the map finished loading
      const pending = requestedViewRef.current
      if (pending) {
        const { lng, lat, zoom, durationMs } = pending
        map.flyTo({ center: [lng, lat], zoom, pitch: 0, duration: durationMs, essential: true })
      }
    })

    // On every pan/zoom, re-project the SVG target overlay
    map.on('move', () => {
      refreshTargetOverlay()
    })

    map.on('zoom', () => {
      // Report zoom as a display multiplier so HUD shows consistent %
      onZoomChangeRef.current(Math.pow(2, map.getZoom() - DEFAULT_MAP_ZOOM))
    })

    const emitViewChange = () => {
      const c = map.getCenter()
      onViewChangeRef.current?.(c.lng, c.lat, map.getZoom(), map.getPitch())
    }

    map.on('moveend', emitViewChange)

    map.on('pitchend', () => {
      emitViewChange()
    })

    mapRef.current = map
    return () => {
      if (readyTimeout) clearTimeout(readyTimeout)
      onReadyChangeRef.current?.(false)
      map.remove()
      mapRef.current = null
      mapLoadedRef.current = false
      resetTarget()
    }
  }, [volumeCache, refreshTargetOverlay, resetTarget])

  // Respond to zoom button changes (flyTo for smooth animation)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (requestedView && Math.abs(requestedView.zoom - mapZoom) <= 0.01) return
    if (Math.abs(map.getZoom() - mapZoom) > 0.01) {
      map.flyTo({ zoom: mapZoom, duration: 400 })
    }
  }, [mapZoom, requestedView])

  // Switch basemap visibility (prefer toggle over reload to avoid flicker)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (!map.getLayer('satellite-layer')) return
      map.setLayoutProperty('satellite-layer', 'visibility', mapType === 'satellite' ? 'visible' : 'none')
      map.setLayoutProperty('topo-layer',      'visibility', mapType === 'topo'      ? 'visible' : 'none')
    }
    if (mapLoadedRef.current) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [mapType])

  // Trigger repaint when frame, pressure levels, or depiction options change
  useEffect(() => {
    mapRef.current?.triggerRepaint()
  }, [frameKey, pressureLevels, diverging, colorScheme, contours, smoothImportedGrids, smoothImportedGridSigma, globalOpacity])

  // Trigger repaint when overlays or their display states change
  useEffect(() => {
    mapRef.current?.triggerRepaint()
  }, [overlays, overlayStates, overlayFrameIndex])

  // Resize map when container becomes visible again after display:none
  useEffect(() => {
    if (isVisible && mapRef.current) {
      mapRef.current.resize()
    }
  }, [isVisible])

  // Imperative camera move (for view sync during transitions)
  useEffect(() => {
    if (!requestedView || !mapRef.current || !mapLoadedRef.current) return
    const { lng, lat, zoom, durationMs } = requestedView
    const map = mapRef.current

    map.stop()
    map.once('moveend', refreshTargetOverlay)
    map.flyTo({ center: [lng, lat], zoom, pitch: 0, duration: durationMs, essential: true })
    if (durationMs <= 0) refreshTargetOverlay()
  }, [requestedView, refreshTargetOverlay])

  // Outer div handles positioning (absolute inset-0).
  // Inner div is the MapLibre container — MapLibre adds .maplibregl-map which sets
  // position:relative, conflicting with Tailwind's `absolute` class and collapsing
  // the canvas to 0 height. Keeping them on separate elements avoids that.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* SVG overlay for target box/point — sits on top of the MapLibre canvas
          without touching the WebGL layer stack */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}
      >
        <g ref={svgGroupRef} style={{ opacity: 0 }}>
          <path ref={svgBoxRef} display="none" />
          <circle ref={svgPointRef} display="none" />
        </g>
      </svg>
      <BasemapAttribution mapType={mapType} />
    </div>
  )
}
