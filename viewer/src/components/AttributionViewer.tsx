/** Full GeoXplain viewer UI used by the browser app and Jupyter widget. */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { TimelineControl } from '@/components/xai/timeline-control'
import { LayersPanel } from '@/components/xai/layers-panel'
import { OverlayPanel } from '@/components/xai/overlay-panel'
import { LegendPanel } from '@/components/xai/legend-panel'
import { ViewControls } from '@/components/xai/view-controls'
import GlobeView, { DEFAULT_ALTITUDE, MAX_GLOBE_ZOOM, MIN_GLOBE_ZOOM } from '@/components/Globe'
import MapView, { DEFAULT_MAP_ZOOM } from '@/components/MapView'
import { buildBrowserLaunchUrl } from '@/lib/launchState'
import { downloadViewerScreenshot } from '@/lib/screenshot'
import { getCurrentTheme } from '@/lib/theme'
import { useThemeContext } from '@/theme-context'
import { DEFAULT_ATTRIBUTION_COLOR_SCHEME } from '@/lib/attributionColor'
import { DEFAULT_TARGET_COLOR } from '@/lib/targets'
import {
  DEFAULT_PRESSURE_LEVELS,
  DEFAULT_APP_SUBTITLE,
  DEFAULT_APP_TITLE,
  buildLevelsFromData,
  OVERLAY_COLORMAPS,
  type AttributionNormalizationMode,
  type AttributionPoint,
  type AttributionPresetColormap,
  type DenseGridInput,
  type DenseLevelGrid,
  type GlobeMapType,
  type OverlayLayerState,
  type PressureLevel,
  type TimestampData,
  type ViewerLaunchState,
  type ViewerMapCameraState,
  type ViewerMode,
} from '@/types'
import {
  computeNormalizationScales,
  hasNormalizationInfo,
} from '@/lib/attributionNormalization'
import { VolumeCache } from '@/globe/volumeCache'
import { ViewerHeader } from '@/components/attributionViewer/ViewerHeader'
import { NoDataHint } from '@/components/attributionViewer/NoDataHint'
import { ViewerActionBar } from '@/components/attributionViewer/ViewerActionBar'
import { MobileMethodLabel } from '@/components/attributionViewer/MobileMethodLabel'
import { useFpsCounter } from '@/components/attributionViewer/useFpsCounter'
import { useMethodSelection } from '@/components/attributionViewer/useMethodSelection'
import {
  applyLaunchPressureLevels,
  computeDataBounds,
  externalGridSignature,
  globeAltitudeToMapZoom,
  mapZoomToGlobeAltitude,
} from '@/components/attributionViewer/viewerHelpers'

const MAP_ZOOM_STEP = Math.log2(1.25)
const DEFAULT_IMPORTED_GRID_SMOOTH_SIGMA = 0.5
const MIN_AUTO_ZOOM = DEFAULT_MAP_ZOOM
const MAX_AUTO_ZOOM = 3.5
const EMPTY_ATTRIBUTION_POINTS: AttributionPoint[] = []
const MAP_CYCLE: GlobeMapType[] = ['satellite', 'topo']

export interface AttributionViewerProps {
  externalData: DenseGridInput | null
  /** Viewer height as CSS length or pixels. Defaults to filling the parent. */
  height?: number | string
  initialViewMode?: 'globe' | 'map'
  initialMapType?: GlobeMapType
  initialContours?: boolean
  initialAbsolute?: boolean
  initialSmoothImportedGrids?: boolean
  /** Multiplier applied to the auto-fit camera distance (>1 zooms out). */
  initialZoomOutFactor?: number
  appTitle?: string
  appSubtitle?: string
  /** Notebook-only browser launch target for opening the standalone bundle. */
  browserLaunchHref?: string
  /** Serialized state restored by browser launches and screenshots. */
  initialLaunchState?: ViewerLaunchState
  /** Notebook bridge: reports current launch state and screenshot surface size. */
  onScreenshotStateChange?: (snapshot: ViewerScreenshotSnapshot) => void
}

export interface ViewerScreenshotSnapshot {
  launchState: ViewerLaunchState
  surface: {
    width: number
    height: number
  }
  ready: boolean
}

export function AttributionViewer({
  externalData,
  height = '100%',
  initialViewMode = 'map',
  initialMapType = 'topo',
  initialContours = false,
  initialAbsolute = false,
  initialSmoothImportedGrids = true,
  initialZoomOutFactor = 1,
  appTitle = DEFAULT_APP_TITLE,
  appSubtitle = DEFAULT_APP_SUBTITLE,
  browserLaunchHref,
  initialLaunchState,
  onScreenshotStateChange,
}: AttributionViewerProps) {
  const launchViewMode = initialLaunchState?.viewMode ?? initialViewMode
  const launchGlobeCamera = initialLaunchState?.globeCamera ?? { lat: 47, lng: 10, altitude: DEFAULT_ALTITUDE }
  const launchMapCamera: ViewerMapCameraState = initialLaunchState?.mapCamera ?? { lng: 10, lat: 47, zoom: DEFAULT_MAP_ZOOM, pitch: 0 }
  const launchGlobeAltitude = launchGlobeCamera.altitude > 0 ? launchGlobeCamera.altitude : DEFAULT_ALTITUDE
  const launchGlobeZoom = Math.min(MAX_GLOBE_ZOOM, Math.max(MIN_GLOBE_ZOOM, DEFAULT_ALTITUDE / launchGlobeAltitude))
  const launchMapZoom = Math.max(0, Math.min(10, launchMapCamera.zoom))
  const launchDisplayZoom = launchViewMode === 'map'
    ? Math.pow(2, launchMapZoom - DEFAULT_MAP_ZOOM)
    : launchGlobeZoom
  const initialMapCenter = useMemo(
    () => [launchMapCamera.lng, launchMapCamera.lat] as [number, number],
    [launchMapCamera.lat, launchMapCamera.lng],
  )

  const [selectedMethod, setSelectedMethod] = useState<string>(initialLaunchState?.selectedMethod ?? 'integrated-gradients')
  const [currentTimestampIndex, setCurrentTimestampIndex] = useState(
    Math.max(0, Math.round(initialLaunchState?.timestampIndex ?? 0)),
  )
  const [pressureLevels, setPressureLevels] = useState<PressureLevel[]>(() => {
    const built = externalData ? buildLevelsFromData(externalData) : []
    const base = built.length > 0 ? built : DEFAULT_PRESSURE_LEVELS
    return applyLaunchPressureLevels(base, initialLaunchState?.pressureLevels)
  })
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [displayZoom, setDisplayZoom] = useState(launchDisplayZoom)
  const [cameraZoom, setCameraZoom] = useState(launchGlobeZoom)
  const [mapType, setMapType] = useState<GlobeMapType>(initialLaunchState?.mapType ?? initialMapType)
  const [contours, setContours] = useState(initialLaunchState?.contours ?? initialContours)
  const [absolute, setAbsolute] = useState(initialLaunchState?.absolute ?? initialAbsolute)
  const [normalization, setNormalization] = useState<AttributionNormalizationMode>(
    initialLaunchState?.normalization ?? 'global',
  )
  const [smoothImportedGrids, setSmoothImportedGrids] = useState(initialLaunchState?.smoothImportedGrids ?? initialSmoothImportedGrids)
  const [smoothImportedGridSigma, setSmoothImportedGridSigma] = useState(initialLaunchState?.smoothImportedGridSigma ?? DEFAULT_IMPORTED_GRID_SMOOTH_SIGMA)
  const [contourAttributionColorSchemes, setContourAttributionColorSchemes] = useState<Record<string, AttributionPresetColormap>>({})
  const preContoursStateRef = useRef<{ smooth: boolean; sigma: number } | null>(null)
  const [viewMode, setViewMode] = useState<ViewerMode>(launchViewMode)
  const { showFpsCounter, fps } = useFpsCounter()
  const [mapZoom, setMapZoom] = useState(launchMapZoom)
  const [resetViewLocked, setResetViewLocked] = useState(false)
  const [globalAttributionOpacity, setGlobalAttributionOpacity] = useState(1.0)
  const [overlayLayerStates, setOverlayLayerStates] = useState<OverlayLayerState[]>(
    () => initialLaunchState?.overlayLayerStates ?? [],
  )
  const [attributionColorSchemes, setAttributionColorSchemes] = useState<Record<string, AttributionPresetColormap>>(
    () => initialLaunchState?.attributionColorSchemes ?? {},
  )
  const [emptyDataHintDismissed, setEmptyDataHintDismissed] = useState(false)
  const [mapRendererReady, setMapRendererReady] = useState(false)
  const [globeRendererReady, setGlobeRendererReady] = useState(false)
  const [isDownloadingScreenshot, setIsDownloadingScreenshot] = useState(false)
  const [viewStateVersion, setViewStateVersion] = useState(0)
  const [screenshotSurfaceSize, setScreenshotSurfaceSize] = useState({ width: 0, height: 0 })

  // Transition state
  const [mapEverMounted, setMapEverMounted] = useState(launchViewMode === 'map')
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [globeVisible, setGlobeVisible] = useState(launchViewMode === 'globe')
  const [mapVisible, setMapVisible] = useState(launchViewMode === 'map')
  const [globeRequestedView, setGlobeRequestedView] = useState<
    { lat: number; lng: number; altitude: number; durationMs: number; id: number } | undefined
  >(undefined)
  const [mapRequestedView, setMapRequestedView] = useState<
    { lng: number; lat: number; zoom: number; durationMs: number; id: number } | undefined
  >(undefined)

  const savedGlobeViewRef = useRef(launchGlobeCamera)
  const savedMapViewRef   = useRef(launchMapCamera)
  const transitionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const resetViewLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoZoomedRef = useRef(false)
  const screenshotSurfaceRef = useRef<HTMLElement | null>(null)

  const [volumeCache] = useState(() => new VolumeCache())
  useEffect(() => () => volumeCache.dispose(), [volumeCache])
  useEffect(() => () => {
    if (resetViewLockTimerRef.current) clearTimeout(resetViewLockTimerRef.current)
  }, [])

  const hasExternalData = externalData !== null

  useEffect(() => {
    const el = screenshotSurfaceRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      const width = Math.max(0, Math.round(rect.width))
      const height = Math.max(0, Math.round(rect.height))
      setScreenshotSurfaceSize((prev) => (
        prev.width === width && prev.height === height ? prev : { width, height }
      ))
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Rebuild the vertical level table from imported data, preserving the user's
  // per-layer visibility/opacity overrides for ids that persist across updates.
  const prevDataLevelsSigRef = useRef<string>('')
  useEffect(() => {
    if (!externalData) return
    const built = buildLevelsFromData(externalData)
    if (built.length === 0) return
    const sig = built.map((l) => `${l.id}:${l.z}:${l.label}`).join('|')
    if (sig === prevDataLevelsSigRef.current) return
    prevDataLevelsSigRef.current = sig
    setPressureLevels((prev) => {
      const prevById = new Map(prev.map((l) => [l.id, l]))
      return built.map((l) => {
        const existing = prevById.get(l.id)
        return existing ? { ...l, visible: existing.visible, opacity: existing.opacity } : l
      })
    })
  }, [externalData])

  // Path A (file export): adopt the Python-side contours default once when
  // data first arrives, unless the launch URL already pinned a style.
  const dataContoursAppliedRef = useRef(false)
  useEffect(() => {
    if (dataContoursAppliedRef.current) return
    if (initialLaunchState?.contours !== undefined) return
    if (externalData?.contours === undefined) return
    dataContoursAppliedRef.current = true
    setContours(externalData.contours)
  }, [externalData, initialLaunchState])

  // Path A (file export): adopt the Python-side absolute default once when data
  // first arrives, unless the launch URL already pinned it.
  const dataAbsoluteAppliedRef = useRef(false)
  useEffect(() => {
    if (dataAbsoluteAppliedRef.current) return
    if (initialLaunchState?.absolute !== undefined) return
    if (externalData?.absolute === undefined) return
    dataAbsoluteAppliedRef.current = true
    setAbsolute(externalData.absolute)
  }, [externalData, initialLaunchState])

  // Adopt the Python-side normalization scope whenever the payload value
  // changes (a later add_attribution(norm=...) call in widget mode updates the
  // viewer), except on first arrival when the launch URL already pinned one.
  const dataNormalizationRef = useRef<AttributionNormalizationMode | null>(null)
  useEffect(() => {
    const dataNormalization = externalData?.normalization
    if (!dataNormalization || dataNormalization === dataNormalizationRef.current) return
    const isFirstAdoption = dataNormalizationRef.current === null
    dataNormalizationRef.current = dataNormalization
    if (isFirstAdoption && initialLaunchState?.normalization !== undefined) return
    setNormalization(dataNormalization)
  }, [externalData, initialLaunchState])

  const dataViewerOptionsAppliedRef = useRef(false)
  useEffect(() => {
    if (dataViewerOptionsAppliedRef.current) return
    const options = externalData?.viewerOptions
    if (!options) return
    dataViewerOptionsAppliedRef.current = true

    if (initialLaunchState?.viewMode === undefined && options.viewMode) {
      const nextViewMode = options.viewMode
      setViewMode(nextViewMode)
      setMapEverMounted((prev) => prev || nextViewMode === 'map')
      setGlobeVisible(nextViewMode === 'globe')
      setMapVisible(nextViewMode === 'map')
      setIsTransitioning(false)
      setDisplayZoom(nextViewMode === 'map'
        ? Math.pow(2, mapZoom - DEFAULT_MAP_ZOOM)
        : cameraZoom)
    }
    if (initialLaunchState?.mapType === undefined && options.mapType) {
      setMapType(options.mapType)
    }
    if (initialLaunchState?.smoothImportedGrids === undefined && typeof options.smoothImportedGrids === 'boolean') {
      setSmoothImportedGrids(options.smoothImportedGrids)
    }
    if (initialLaunchState?.smoothImportedGridSigma === undefined && typeof options.smoothImportedGridSigma === 'number') {
      setSmoothImportedGridSigma(options.smoothImportedGridSigma)
    }
  }, [cameraZoom, externalData, initialLaunchState, mapZoom])

  useEffect(() => {
    setEmptyDataHintDismissed(false)
  }, [externalData])

  // On the first XAI data import, auto-zoom to the region with significant attribution.
  useEffect(() => {
    if (!externalData) {
      autoZoomedRef.current = false
      return
    }
    if (autoZoomedRef.current) return
    autoZoomedRef.current = true

    const bounds = computeDataBounds(externalData)
    if (!bounds) return

    const { latMin, latMax, lonMin, lonMax } = bounds
    const centerLat = (latMin + latMax) / 2
    const centerLng = (lonMin + lonMax) / 2
    const lngSpan = lonMax - lonMin
    const latSpan = latMax - latMin
    const paddedSpan = Math.max(lngSpan, latSpan * 2) * 1.5
    const fitZoom = Math.log2(360 / paddedSpan)
    const zoomOut = initialZoomOutFactor > 0 ? initialZoomOutFactor : 1
    const targetZoom = Math.max(
      MIN_AUTO_ZOOM,
      Math.min(MAX_AUTO_ZOOM, fitZoom - Math.log2(zoomOut)),
    )
    const targetAlt = mapZoomToGlobeAltitude(targetZoom)

    savedGlobeViewRef.current = { lat: centerLat, lng: centerLng, altitude: targetAlt }
    savedMapViewRef.current = { lng: centerLng, lat: centerLat, zoom: targetZoom, pitch: 0 }
    setMapZoom(targetZoom)
    setDisplayZoom(Math.pow(2, targetZoom - DEFAULT_MAP_ZOOM))
    setMapRequestedView({ lng: centerLng, lat: centerLat, zoom: targetZoom, durationMs: 1200, id: Date.now() })
    setGlobeRequestedView({ lat: centerLat, lng: centerLng, altitude: targetAlt, durationMs: 1200, id: Date.now() })
    setViewStateVersion((version) => version + 1)
  }, [externalData, initialZoomOutFactor])

  // Sync overlay layer states when externalData.overlays changes.
  // Preserves existing user overrides (opacity, colormap, visibility) for slugs
  // that are already in state; adds defaults for new slugs; removes stale ones.
  useEffect(() => {
    const incomingSlugs = Object.keys(externalData?.overlays ?? {})
    setOverlayLayerStates((prev) => {
      const prevBySlug = new Map(prev.map((s) => [s.slug, s]))
      return incomingSlugs.map((slug) => {
        const existing = prevBySlug.get(slug)
        if (existing) return existing
        const overlay = externalData?.overlays?.[slug]
        const defaultColormap = overlay?.colormap ?? 'viridis'
        const defaultVisible = overlay?.visible ?? true
        return {
          slug,
          visible: defaultVisible,
          opacity: overlay?.opacity ?? 0.7,
          colormap: OVERLAY_COLORMAPS.includes(defaultColormap as never) ? defaultColormap as OverlayLayerState['colormap'] : 'viridis',
          stretchLow: overlay?.stretchLow ?? 0,
          stretchHigh: overlay?.stretchHigh ?? 1,
        }
      })
    })
  }, [externalData?.overlays])

  const {
    selectorMethods,
    hasInputVarSelector,
    currentMethodBase,
    currentInputVarOptions,
    activeInputVar,
    handleInputVarChange,
    handleMethodSelect,
  } = useMethodSelection(externalData, selectedMethod, setSelectedMethod)

  const currentExternalMethod = useMemo(
    () => externalData ? (externalData.methods[selectedMethod] ?? null) : null,
    [externalData, selectedMethod],
  )

  const currentExternalFrame = useMemo(
    () => currentExternalMethod?.frames[currentTimestampIndex] ?? currentExternalMethod?.frames[0] ?? null,
    [currentExternalMethod, currentTimestampIndex],
  )

  const currentExternalLevels = useMemo<Record<string, DenseLevelGrid> | null>(
    () => currentExternalFrame?.levels ?? null,
    [currentExternalFrame],
  )
  const currentTarget = currentExternalFrame?.target ?? null
  const targetColor = externalData?.targetColor ?? DEFAULT_TARGET_COLOR
  // Whether the data itself is signed (auto-detected on input). The "Signed values"
  // toggle can override the *display*: when off, diverging data is folded to absolute
  // magnitude and rendered sequentially, so the effective `diverging` becomes false.
  const inferredDiverging = currentExternalFrame?.diverging
    ?? currentExternalMethod?.diverging
    ?? externalData?.diverging
    ?? false
  const diverging = inferredDiverging && !absolute
  const absoluteActive = inferredDiverging && absolute
  const normalColorScheme = useMemo(() => {
    const override = attributionColorSchemes[selectedMethod]
    if (override) return { type: 'preset' as const, name: override }
    return currentExternalMethod?.colorScheme ?? DEFAULT_ATTRIBUTION_COLOR_SCHEME
  }, [attributionColorSchemes, currentExternalMethod, selectedMethod])
  const hasCustomColorScheme = currentExternalMethod?.colorScheme?.type === 'custom'
  const defaultContourPalette: AttributionPresetColormap = hasCustomColorScheme
    ? 'contour-custom'
    : diverging ? 'contour-blue-red' : 'contour-default'
  const colorScheme = useMemo(() => {
    if (contours) {
      const name = (contourAttributionColorSchemes[selectedMethod] ?? defaultContourPalette) as AttributionPresetColormap
      if (name === 'contour-custom') {
        const custom = currentExternalMethod?.colorScheme
        if (custom?.type === 'custom') return custom
      }
      return { type: 'preset' as const, name }
    }
    return normalColorScheme
  }, [contours, contourAttributionColorSchemes, selectedMethod, normalColorScheme, defaultContourPalette, currentExternalMethod])
  const selectedAttributionPalette = normalColorScheme.type === 'preset' ? normalColorScheme.name : null
  const selectedContourPalette = (contourAttributionColorSchemes[selectedMethod] ?? defaultContourPalette) as AttributionPresetColormap
  const currentExternalGridSignature = useMemo(
    () => externalGridSignature(currentExternalLevels),
    [currentExternalLevels],
  )
  const availableExternalLevelIds = useMemo(
    () => currentExternalLevels ? new Set(Object.keys(currentExternalLevels)) : null,
    [currentExternalLevels],
  )

  // Live normalization-scope rescaling needs per-level maxAbs metadata
  // (payload v5+); older payloads render at their baked normalization.
  const normalizationAvailable = useMemo(
    () => hasNormalizationInfo(externalData),
    [externalData],
  )
  const currentNormScales = useMemo(
    () => normalizationAvailable && externalData
      ? computeNormalizationScales(externalData, selectedMethod, currentTimestampIndex, normalization)
      : null,
    [normalizationAvailable, externalData, selectedMethod, currentTimestampIndex, normalization],
  )

  useEffect(() => {
    if (!currentExternalMethod) return
    setCurrentTimestampIndex((prev) => Math.min(prev, Math.max(0, currentExternalMethod.frames.length - 1)))
  }, [currentExternalMethod])

  const timelineData = useMemo(() => {
    if (!externalData) return []
    const frames = currentExternalMethod?.frames ?? []
    return frames.map((frame, index) => {
      const ts = frame.timestamp ? new Date(frame.timestamp) : new Date()
      const label = frame.timestamp
        ? frame.timestamp.slice(0, 16).replace('T', ' ') + ' UTC'
        : (frames.length > 1 ? `Imported data ${index + 1}` : 'Imported data')
      return { timestamp: ts, label, methods: {} as TimestampData['methods'] }
    })
  }, [externalData, currentExternalMethod])

  const currentPoints = EMPTY_ATTRIBUTION_POINTS

  const nextTimestampIndex = timelineData.length > 0
    ? (currentTimestampIndex + 1) % timelineData.length
    : 0
  const nextExternalFrame = useMemo(
    () => currentExternalMethod?.frames[nextTimestampIndex] ?? null,
    [currentExternalMethod, nextTimestampIndex],
  )
  const nextExternalLevels = useMemo<Record<string, DenseLevelGrid> | null>(
    () => nextExternalFrame?.levels ?? null,
    [nextExternalFrame],
  )
  const nextExternalGridSignature = useMemo(
    () => externalGridSignature(nextExternalLevels),
    [nextExternalLevels],
  )
  const nextNormScales = useMemo(
    () => normalizationAvailable && externalData
      ? computeNormalizationScales(externalData, selectedMethod, nextTimestampIndex, normalization)
      : null,
    [normalizationAvailable, externalData, selectedMethod, nextTimestampIndex, normalization],
  )
  const nextPoints = EMPTY_ATTRIBUTION_POINTS
  const nextFrameKey = useMemo(
    () => externalData
      ? `external:${selectedMethod}:${nextExternalFrame?.timestamp ?? nextTimestampIndex}:${nextExternalGridSignature}`
      : `${nextTimestampIndex}:${selectedMethod}`,
    [externalData, selectedMethod, nextTimestampIndex, nextExternalFrame, nextExternalGridSignature],
  )

  const frameKey = useMemo(
    () => externalData
      ? `external:${selectedMethod}:${currentExternalFrame?.timestamp ?? currentTimestampIndex}:${currentExternalGridSignature}`
      : `${currentTimestampIndex}:${selectedMethod}`,
    [externalData, selectedMethod, currentTimestampIndex, currentExternalGridSignature, currentExternalFrame],
  )

  const blendMs = useMemo(
    () => Math.max(250, Math.min(900, 0.8 * (1000 / playbackSpeed))),
    [playbackSpeed],
  )

  const handleTimestampChange = useCallback((index: number) => setCurrentTimestampIndex(index), [])
  const handlePlayPause = useCallback(() => setIsPlaying((p) => !p), [])

  const handleGlobeViewChange = useCallback((lat: number, lng: number, altitude: number) => {
    savedGlobeViewRef.current = { lat, lng, altitude }
    setViewStateVersion((version) => version + 1)
  }, [])
  const handleMapViewChange = useCallback((lng: number, lat: number, zoom: number, pitch: number) => {
    savedMapViewRef.current = { lng, lat, zoom, pitch }
    setViewStateVersion((version) => version + 1)
  }, [])

  const handleZoomIn = useCallback(() => {
    if (isTransitioning) return
    if (viewMode === 'map') {
      setMapZoom((z) => Math.min(z + MAP_ZOOM_STEP, 10))
    } else {
      setDisplayZoom((prev) => {
        const next = Math.min(prev * 1.25, MAX_GLOBE_ZOOM)
        setCameraZoom(next)
        return next
      })
    }
  }, [viewMode, isTransitioning])

  const handleZoomOut = useCallback(() => {
    if (isTransitioning) return
    if (viewMode === 'map') {
      setMapZoom((z) => Math.max(z - MAP_ZOOM_STEP, 0))
    } else {
      setDisplayZoom((prev) => {
        const next = Math.max(prev / 1.25, MIN_GLOBE_ZOOM)
        setCameraZoom(next)
        return next
      })
    }
  }, [viewMode, isTransitioning])

  const handleResetView = useCallback(() => {
    if (isTransitioning || resetViewLocked) return
    setResetViewLocked(true)
    if (resetViewLockTimerRef.current) clearTimeout(resetViewLockTimerRef.current)
    resetViewLockTimerRef.current = setTimeout(() => {
      resetViewLockTimerRef.current = null
      setResetViewLocked(false)
    }, 500)

    if (viewMode === 'map') {
      const { lng, lat } = savedMapViewRef.current
      const resetView = { lng, lat, zoom: DEFAULT_MAP_ZOOM }
      savedMapViewRef.current = { ...resetView, pitch: 0 }
      setMapZoom(DEFAULT_MAP_ZOOM)
      setDisplayZoom(1)
      setMapRequestedView({ ...resetView, durationMs: 400, id: Date.now() })
      setViewStateVersion((version) => version + 1)
    } else {
      const resetView = { lat: 47, lng: 10, altitude: DEFAULT_ALTITUDE }
      savedGlobeViewRef.current = resetView
      setDisplayZoom(1)
      setCameraZoom(1)
      setGlobeRequestedView({ ...resetView, durationMs: 400, id: Date.now() })
      setViewStateVersion((version) => version + 1)
    }
  }, [viewMode, isTransitioning, resetViewLocked])

  const handleZoomChange = useCallback((z: number) => setDisplayZoom(z), [])

  const handleMapTypeToggle = useCallback(() => {
    setMapType((t) => MAP_CYCLE[(MAP_CYCLE.indexOf(t) + 1) % MAP_CYCLE.length])
  }, [])

  const handleAttributionPaletteChange = useCallback((palette: AttributionPresetColormap) => {
    setAttributionColorSchemes((prev) => ({
      ...prev,
      [selectedMethod]: palette,
    }))
  }, [selectedMethod])

  const handleContourPaletteChange = useCallback((palette: AttributionPresetColormap) => {
    setContourAttributionColorSchemes((prev) => ({
      ...prev,
      [selectedMethod]: palette,
    }))
  }, [selectedMethod])

  const handleContoursChange = useCallback((enabled: boolean) => {
    if (enabled) {
      preContoursStateRef.current = {
        smooth: smoothImportedGrids,
        sigma: smoothImportedGridSigma,
      }
      setSmoothImportedGrids(true)
      setSmoothImportedGridSigma(0.1)
    } else {
      if (preContoursStateRef.current) {
        setSmoothImportedGrids(preContoursStateRef.current.smooth)
        setSmoothImportedGridSigma(preContoursStateRef.current.sigma)
        preContoursStateRef.current = null
      }
    }
    setContours(enabled)
  }, [smoothImportedGrids, smoothImportedGridSigma])

  const handleViewModeToggle = useCallback(() => {
    if (isTransitioning) return
    transitionTimersRef.current.forEach(clearTimeout)

    if (viewMode === 'globe') {
      const { lat, lng, altitude } = savedGlobeViewRef.current
      const targetZoom = Math.max(0, Math.min(10, globeAltitudeToMapZoom(altitude)))
      savedMapViewRef.current = { lng, lat, zoom: targetZoom, pitch: 0 }
      setMapZoom(targetZoom)
      setDisplayZoom(Math.pow(2, targetZoom - DEFAULT_MAP_ZOOM))
      setMapRequestedView({ lng, lat, zoom: targetZoom, durationMs: 0, id: Date.now() })
      setMapEverMounted(true)
      setViewMode('map')
      setIsTransitioning(true)

      const t1 = setTimeout(() => { setMapVisible(true); setGlobeVisible(false) }, 16)
      const t2 = setTimeout(() => { setIsTransitioning(false) }, 500)
      transitionTimersRef.current = [t1, t2]
    } else {
      const { lng, lat, zoom } = savedMapViewRef.current
      const targetAlt = mapZoomToGlobeAltitude(zoom)
      savedGlobeViewRef.current = { lat, lng, altitude: targetAlt }

      const targetDisplayZoom = Math.pow(2, zoom - DEFAULT_MAP_ZOOM)
      setGlobeRequestedView({ lat, lng, altitude: targetAlt, durationMs: 0, id: Date.now() })
      setCameraZoom(targetDisplayZoom)
      setDisplayZoom(targetDisplayZoom)
      setViewMode('globe')
      setIsTransitioning(true)

      const t1 = setTimeout(() => { setGlobeVisible(true); setMapVisible(false) }, 16)
      const t2 = setTimeout(() => { setIsTransitioning(false) }, 500)
      transitionTimersRef.current = [t1, t2]
    }
  }, [viewMode, isTransitioning])

  const { scopedRoot } = useThemeContext()

  const viewerReady = hasExternalData && !isTransitioning && (viewMode === 'map' ? mapRendererReady : globeRendererReady)

  const buildCurrentLaunchState = useCallback((): ViewerLaunchState => {
    // savedGlobeViewRef/savedMapViewRef are mutable and don't trigger renders;
    // viewStateVersion is bumped on camera moves so this callback (and the
    // screenshot reporter depending on it) re-derives with the latest cameras.
    void viewStateVersion
    return {
      selectedMethod,
      timestampIndex: currentTimestampIndex,
      viewMode,
      mapType,
      theme: getCurrentTheme(scopedRoot),
      contours,
      absolute,
      normalization,
      attributionColorSchemes,
      overlayLayerStates,
      pressureLevels: pressureLevels.map((level) => ({
        id: level.id,
        visible: level.visible,
        opacity: level.opacity,
      })),
      smoothImportedGrids,
      smoothImportedGridSigma,
      globeCamera: savedGlobeViewRef.current,
      mapCamera: savedMapViewRef.current,
    }
  },
    [
      scopedRoot,
      attributionColorSchemes,
      contours,
      absolute,
      normalization,
      currentTimestampIndex,
      mapType,
      overlayLayerStates,
      pressureLevels,
      selectedMethod,
      smoothImportedGrids,
      smoothImportedGridSigma,
      viewMode,
      viewStateVersion,
    ],
  )

  useEffect(() => {
    if (!onScreenshotStateChange) return
    onScreenshotStateChange({
      launchState: buildCurrentLaunchState(),
      surface: screenshotSurfaceSize,
      ready: viewerReady,
    })
  }, [
    buildCurrentLaunchState,
    onScreenshotStateChange,
    screenshotSurfaceSize,
    viewerReady,
  ])

  const handleOpenInBrowser = useCallback(() => {
    if (!browserLaunchHref) return
    const launchState = buildCurrentLaunchState()
    window.open(buildBrowserLaunchUrl(browserLaunchHref, launchState), '_blank', 'noopener,noreferrer')
  }, [browserLaunchHref, buildCurrentLaunchState])

  const handleDownloadScreenshot = useCallback(async () => {
    const surface = screenshotSurfaceRef.current
    if (!surface || !viewerReady) return

    setIsDownloadingScreenshot(true)
    try {
      await downloadViewerScreenshot({ surface, viewMode, mapType })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('GeoXplain screenshot failed:', error)
      window.alert(message)
    } finally {
      setIsDownloadingScreenshot(false)
    }
  }, [mapType, viewerReady, viewMode])

  const heightStyle = typeof height === 'number' ? `${height}px` : height
  const headerTitle = appTitle.trim() || DEFAULT_APP_TITLE
  const headerSubtitle = appSubtitle.trim()
  const activeMethodLabel = currentMethodBase && activeInputVar
    ? `${currentMethodBase} w.r.t. ${activeInputVar}`
    : selectorMethods.find((m) => m.id === selectedMethod)?.label ?? selectedMethod

  return (
    <div
      className="w-full flex flex-col overflow-hidden bg-background text-foreground"
      style={{ height: heightStyle }}
      data-geoxplain-viewer-root
    >
      {/* Top header */}
      <ViewerHeader
        headerTitle={headerTitle}
        headerSubtitle={headerSubtitle}
        hasExternalData={hasExternalData}
        selectorMethods={selectorMethods}
        hasInputVarSelector={hasInputVarSelector}
        currentMethodBase={currentMethodBase}
        selectedMethod={selectedMethod}
        onMethodSelect={handleMethodSelect}
        currentInputVarOptions={currentInputVarOptions}
        activeInputVar={activeInputVar}
        onInputVarChange={handleInputVarChange}
      />

      {/* Main visualization area */}
      <main
        ref={screenshotSurfaceRef}
        className="flex-1 relative min-h-0"
        data-geoxplain-screenshot-surface
        data-geoxplain-viewer-ready={viewerReady ? 'true' : 'false'}
      >
        {/* Globe */}
        <div
          className="absolute inset-0"
          data-geoxplain-renderer-layer="globe"
          data-geoxplain-active={viewMode === 'globe' && globeVisible ? 'true' : 'false'}
          style={{
            opacity: globeVisible ? 1 : 0,
            transition: 'opacity 0.4s ease-in-out',
            pointerEvents: globeVisible && !isTransitioning ? 'auto' : 'none',
          }}
        >
          <GlobeView
            volumeCache={volumeCache}
            points={currentPoints}
            pressureLevels={pressureLevels}
            cameraZoom={cameraZoom}
            mapType={mapType}
            onZoomChange={handleZoomChange}
            frameKey={frameKey}
            blendMs={blendMs}
            smoothImportedGrids={smoothImportedGrids}
            smoothImportedGridSigma={smoothImportedGridSigma}
            externalGrids={currentExternalLevels}
            diverging={diverging}
            absolute={absoluteActive}
            normScales={currentNormScales?.scales ?? null}
            colorScheme={colorScheme}
            contours={contours}
            target={currentTarget}
            targetColor={targetColor}
            nextFrameKey={nextFrameKey}
            nextPoints={nextPoints}
            nextExternalGrids={nextExternalLevels}
            nextNormScales={nextNormScales?.scales ?? null}
            onViewChange={handleGlobeViewChange}
            requestedView={globeRequestedView}
            isActive={globeVisible || isTransitioning}
            overlays={externalData?.overlays}
            overlayStates={overlayLayerStates}
            overlayFrameIndex={currentTimestampIndex}
            globalOpacity={globalAttributionOpacity}
            onReadyChange={setGlobeRendererReady}
          />
        </div>

        {/* Map — lazily mounted on first visit */}
        {mapEverMounted && (
          <div
            className="absolute inset-0"
            data-geoxplain-renderer-layer="map"
            data-geoxplain-active={viewMode === 'map' && mapVisible ? 'true' : 'false'}
            style={{
              opacity: mapVisible ? 1 : 0,
              display: !mapVisible && !isTransitioning ? 'none' : undefined,
              transition: 'opacity 0.4s ease-in-out',
              pointerEvents: mapVisible && !isTransitioning ? 'auto' : 'none',
            }}
          >
            <MapView
              volumeCache={volumeCache}
              points={currentPoints}
              pressureLevels={pressureLevels}
              mapType={mapType}
              frameKey={frameKey}
              blendMs={blendMs}
              smoothImportedGrids={smoothImportedGrids}
              smoothImportedGridSigma={smoothImportedGridSigma}
              mapZoom={mapZoom}
              onZoomChange={handleZoomChange}
              externalGrids={currentExternalLevels}
              diverging={diverging}
              absolute={absoluteActive}
              normScales={currentNormScales?.scales ?? null}
              colorScheme={colorScheme}
              contours={contours}
              target={currentTarget}
              targetColor={targetColor}
              nextFrameKey={nextFrameKey}
              nextPoints={nextPoints}
              nextExternalGrids={nextExternalLevels}
              nextNormScales={nextNormScales?.scales ?? null}
              initialCenter={initialMapCenter}
              initialZoom={launchMapCamera.zoom}
              onViewChange={handleMapViewChange}
              requestedView={mapRequestedView}
              isVisible={mapVisible || isTransitioning}
              overlays={externalData?.overlays}
              overlayStates={overlayLayerStates}
              overlayFrameIndex={currentTimestampIndex}
              globalOpacity={globalAttributionOpacity}
              onReadyChange={setMapRendererReady}
            />
          </div>
        )}

        {!hasExternalData && !emptyDataHintDismissed && (
          <NoDataHint onDismiss={() => setEmptyDataHintDismissed(true)} />
        )}

        {/* Left: pressure levels + overlays + legend */}
        {hasExternalData && (
          <div
            className="xai-left-scroll absolute left-4 top-4 bottom-4 z-10 flex max-w-70 flex-col gap-3 overflow-y-auto pr-1"
            data-geoxplain-screenshot-exclude
          >
            <LayersPanel
              pressureLevels={pressureLevels}
              onPressureLevelChange={setPressureLevels}
              contours={contours}
              onContoursChange={handleContoursChange}
              hasImportedGrids
              smoothImportedGrids={smoothImportedGrids}
              onSmoothImportedGridsChange={setSmoothImportedGrids}
              smoothImportedGridSigma={smoothImportedGridSigma}
              onSmoothImportedGridSigmaChange={setSmoothImportedGridSigma}
              selectedAttributionPalette={selectedAttributionPalette}
              onAttributionPaletteChange={handleAttributionPaletteChange}
              selectedContourPalette={selectedContourPalette}
              onContourPaletteChange={handleContourPaletteChange}
              hasCustomColorScheme={hasCustomColorScheme}
              customColorScheme={currentExternalMethod?.colorScheme}
              availableLevelIds={availableExternalLevelIds}
              globalOpacity={globalAttributionOpacity}
              onGlobalOpacityChange={setGlobalAttributionOpacity}
              diverging={diverging}
              signed={!absolute}
              onSignedChange={(v) => setAbsolute(!v)}
              canToggleSigned={inferredDiverging}
              normalization={normalization}
              onNormalizationChange={setNormalization}
              canSelectNormalization={normalizationAvailable}
            />
            {externalData?.overlays && Object.keys(externalData.overlays).length > 0 && (
              <OverlayPanel
                overlays={externalData.overlays}
                overlayStates={overlayLayerStates}
                onOverlayStatesChange={setOverlayLayerStates}
              />
            )}
            <div className="mt-auto">
              <LegendPanel
                attributionColorScheme={colorScheme}
                diverging={diverging}
                contours={contours}
                methodLabel={currentExternalMethod?.label}
                attributionMaxAbs={currentNormScales?.targetMaxAbs ?? null}
                overlays={externalData?.overlays}
                overlayStates={overlayLayerStates}
              />
            </div>
          </div>
        )}

        {/* Right: zoom controls */}
        <div
          className="absolute right-4 top-4 z-10 flex flex-col items-end gap-3"
          data-geoxplain-screenshot-exclude
        >
          {showFpsCounter && (
            <div className="rounded-md border border-border/60 bg-card/85 px-3 py-1.5 font-mono text-xs tabular-nums text-foreground shadow-sm backdrop-blur-sm">
              {fps} FPS
            </div>
          )}
          <ViewControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onReset={handleResetView}
            resetDisabled={resetViewLocked}
            zoom={displayZoom}
            mapType={mapType}
            onMapTypeToggle={handleMapTypeToggle}
            viewMode={viewMode}
            onViewModeToggle={handleViewModeToggle}
          />
        </div>

        {hasExternalData && (
          <ViewerActionBar
            browserLaunchHref={browserLaunchHref}
            onOpenInBrowser={handleOpenInBrowser}
            onDownloadScreenshot={handleDownloadScreenshot}
            downloadDisabled={!viewerReady || isDownloadingScreenshot}
          />
        )}

        {/* Mobile method label */}
        {hasExternalData && (
          <MobileMethodLabel
            label={activeMethodLabel}
          />
        )}
      </main>

      {/* Bottom timeline — hidden when no data or imported data has no timestamp */}
      {hasExternalData && (!!currentExternalFrame?.timestamp || (currentExternalMethod?.frames.length ?? 0) > 1) && (
        <div className="shrink-0" data-geoxplain-screenshot-exclude>
          <TimelineControl
            timestamps={timelineData}
            currentIndex={currentTimestampIndex}
            onIndexChange={handleTimestampChange}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            playbackSpeed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
          />
        </div>
      )}
    </div>
  )
}
