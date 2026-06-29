import { memo, useCallback, useEffect, useRef, useState } from 'react'
import GlobeGL from 'react-globe.gl'
import type { GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import { DEFAULT_TARGET_COLOR, normalizeTargetColor, targetSignature } from '@/lib/targets'
import type { AttributionColorScheme, AttributionPoint, DenseLevelGrid, GlobeMapType, OverlayData, OverlayLayerState, PressureLevel, ViewerTarget } from '@/types'
import {
  attributionColorSchemeId,
  attributionColorSchemeSignature,
  DEFAULT_ATTRIBUTION_COLOR_SCHEME,
} from '@/lib/attributionColor'
import { VolumeCache } from '@/globe/volumeCache'
import { vertexShader, fragmentShader } from '@/globe/shaders'
import { GLOBE_RADIUS } from '@/globe/constants'
import { heatmapColor } from '@/globe/heatmapFallback'
import { emptyVolume, hasDenseGridData } from '@/globe/volumeTextures'
import { colorSchemeTexture, applyColorSchemeUniforms } from '@/globe/attributionColorUniforms'
import {
  buildTargetGroup,
  disposeTargetGroup,
  POINT_MARKER_FILL_PX,
  setTargetGroupColor,
  setTargetGroupOpacity,
} from '@/globe/targetOverlay'
import { useContainerSize } from '@/globe/useContainerSize'
import { useGlobeOverlays } from '@/globe/useGlobeOverlays'
import { BasemapAttribution } from './BasemapAttribution'

interface GlobeViewProps {
  points: AttributionPoint[]
  pressureLevels: PressureLevel[]
  /** Button-driven zoom target; scroll/pinch zoom is reported separately. */
  cameraZoom: number
  mapType: GlobeMapType
  onZoomChange: (zoom: number) => void
  frameKey: string
  blendMs: number
  smoothImportedGrids: boolean
  smoothImportedGridSigma: number
  volumeCache: VolumeCache
  /** Dense grids bypass the sparse-points volume path when present. */
  externalGrids?: Record<string, DenseLevelGrid> | null
  diverging?: boolean
  absolute?: boolean
  colorScheme?: AttributionColorScheme
  contours?: boolean
  target?: ViewerTarget | null
  targetColor?: string
  nextFrameKey?: string
  nextPoints?: AttributionPoint[]
  nextExternalGrids?: Record<string, DenseLevelGrid> | null
  onViewChange?: (lat: number, lng: number, altitude: number) => void
  /** Repeated camera moves are keyed by id so identical positions still run. */
  requestedView?: { lat: number; lng: number; altitude: number; durationMs: number; id: number }
  /** Pauses the Three.js render loop when the view is hidden. */
  isActive?: boolean
  globalOpacity?: number
  overlays?: Record<string, OverlayData> | null
  overlayStates?: OverlayLayerState[]
  overlayFrameIndex?: number
  /** Reports when the globe is ready for screenshot capture. */
  onReadyChange?: (ready: boolean) => void
}

interface GlobeControlsEvents {
  addEventListener: (type: 'change', listener: () => void) => void
  removeEventListener: (type: 'change', listener: () => void) => void
}

export const DEFAULT_ALTITUDE = 1.5
export const MIN_GLOBE_ZOOM = 0.25
export const MAX_GLOBE_ZOOM = 128

// Stable tile URL functions
const TILE_URLS: Record<GlobeMapType, (x: number, y: number, level: number) => string> = {
  satellite: (x, y, level) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${y}/${x}`,
  topo: (x, y, level) =>
    // Previous outline/label option:
    // `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${level}/${y}/${x}`,
    `https://a.basemaps.cartocdn.com/light_nolabels/${level}/${x}/${y}.png`,
}

// Volume shell radii (paper-thin, hugs the surface)
const R_INNER_FLAT = GLOBE_RADIUS * (1 + 0.000)
const R_OUTER_FLAT = GLOBE_RADIUS * (1 + 0.004)

const ALPHA_FLAT = 0.7

const GLOBE_RENDERER_CONFIG = { preserveDrawingBuffer: true, alpha: true }

function GlobeViewInner({
  points,
  pressureLevels,
  cameraZoom,
  mapType,
  onZoomChange,
  frameKey,
  blendMs,
  smoothImportedGrids,
  smoothImportedGridSigma,
  volumeCache,
  externalGrids,
  diverging = false,
  absolute = false,
  colorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME,
  contours = false,
  target = null,
  targetColor = DEFAULT_TARGET_COLOR,
  nextFrameKey,
  nextPoints,
  nextExternalGrids,
  onViewChange,
  requestedView,
  isActive = true,
  overlays,
  overlayStates = [],
  overlayFrameIndex = 0,
  globalOpacity = 1,
  onReadyChange,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const { containerRef, dimensions } = useContainerSize()
  const didMountRef = useRef(false)
  const isWebGL2Ref = useRef(true)
  // State mirror of isWebGL2Ref so the render path (heatmap fallback) can read
  // the capability without touching a ref during render; callbacks keep the ref.
  const [isWebGL2, setIsWebGL2] = useState(true)
  const [globeReady, setGlobeReady] = useState(false)
  const buildingIndicatorRef = useRef<HTMLDivElement>(null)

  const onViewChangeRef = useRef(onViewChange)

  // Volumetric rendering refs (persistent across renders)
  const volumeMeshRef = useRef<THREE.Mesh | null>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const blendRafRef = useRef<number>(0)
  const activeFrameKeyRef = useRef('')
  const emptyTexRef = useRef<THREE.Data3DTexture | null>(null)
  const prevTexRef = useRef<THREE.Data3DTexture | null>(null)
  const nextTexRef = useRef<THREE.Data3DTexture | null>(null)
  const prevDivergingRef = useRef(false)
  const nextDivergingRef = useRef(false)
  const prevColorSchemeRef = useRef<AttributionColorScheme>(DEFAULT_ATTRIBUTION_COLOR_SCHEME)
  const nextColorSchemeRef = useRef<AttributionColorScheme>(DEFAULT_ATTRIBUTION_COLOR_SCHEME)
  const prevImportedFlatDivergingAlphaRef = useRef(false)
  const nextImportedFlatDivergingAlphaRef = useRef(false)
  const prevImportedFlatSequentialAlphaRef = useRef(false)
  const nextImportedFlatSequentialAlphaRef = useRef(false)
  // Tracks whether at least one real texture has been shown; prevents the
  // empty placeholder (all-zero → blue in diverging mode) from flashing on first load.
  const hasRealDataRef = useRef(false)
  const targetPrevGroupRef = useRef<THREE.Group | null>(null)
  const targetNextGroupRef = useRef<THREE.Group | null>(null)
  const targetBlendRafRef = useRef<number>(0)
  const currentTargetRef = useRef<ViewerTarget | null>(null)
  const targetKeyRef = useRef('none')
  const controlsRef = useRef<GlobeControlsEvents | null>(null)
  const invProjectionViewRef = useRef(new THREE.Matrix4())
  const drawingBufferSizeRef = useRef(new THREE.Vector2(1, 1))
  const markerWorldPosRef = useRef(new THREE.Vector3())
  const onReadyChangeRef = useRef(onReadyChange)

  // Mirror latest callbacks into refs after each commit; both are read only
  // inside event handlers / effects, never during render.
  useEffect(() => {
    onViewChangeRef.current = onViewChange
    onReadyChangeRef.current = onReadyChange
  })

  const updateRaymarchViewUniforms = useCallback(() => {
    const g = globeRef.current
    const mat = materialRef.current
    if (!g || !mat) return

    const camera = g.camera()
    camera.updateMatrixWorld()
    if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix()
    }
    invProjectionViewRef.current
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .invert()
    mat.uniforms.uInvProjectionView.value.copy(invProjectionViewRef.current)

    g.renderer().getDrawingBufferSize(drawingBufferSizeRef.current)
    mat.uniforms.uViewport.value.copy(drawingBufferSizeRef.current)
  }, [])

  // Keep point markers at a constant on-screen pixel size regardless of zoom,
  // so they read as a precise pin instead of growing/shrinking with the globe.
  const updateTargetMarkerScale = useCallback(() => {
    const g = globeRef.current
    if (!g) return
    const camera = g.camera() as THREE.PerspectiveCamera
    if (!camera.isPerspectiveCamera) return
    const size = g.renderer().getDrawingBufferSize(drawingBufferSizeRef.current)
    if (!size.y) return
    // World units spanned by one pixel, per unit of distance from the camera.
    const worldPerPixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / size.y
    for (const group of [targetPrevGroupRef.current, targetNextGroupRef.current]) {
      if (!group) continue
      for (const child of group.children) {
        if (!(child instanceof THREE.Sprite)) continue
        const px = (child.userData.pixelSize as number) ?? POINT_MARKER_FILL_PX
        const dist = camera.position.distanceTo(child.getWorldPosition(markerWorldPosRef.current))
        const s = px * worldPerPixel * dist
        child.scale.set(s, s, 1)
      }
    }
  }, [])

  const markCaptureReady = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => onReadyChangeRef.current?.(true))
    })
  }, [])

  useEffect(() => {
    onReadyChangeRef.current?.(false)
    return () => onReadyChangeRef.current?.(false)
  }, [])

  // Set initial camera, detect WebGL2, create volume mesh once
  const handleGlobeReady = useCallback(() => {
    const g = globeRef.current
    if (!g) return
    g.pointOfView({ lat: 47, lng: 10, altitude: DEFAULT_ALTITUDE }, 0)
    didMountRef.current = true

    g.renderer().compile(g.scene(), g.camera())

    // Detect WebGL2
    const renderer = g.renderer()
    const gl = renderer.getContext()
    isWebGL2Ref.current = gl instanceof WebGL2RenderingContext
    setIsWebGL2(isWebGL2Ref.current)

    const overlayColor = normalizeTargetColor(targetColor)
    const prevTargetGroup = buildTargetGroup(null, overlayColor)
    const nextTargetGroup = buildTargetGroup(null, overlayColor)
    targetPrevGroupRef.current = prevTargetGroup
    targetNextGroupRef.current = nextTargetGroup
    g.scene().add(prevTargetGroup)
    g.scene().add(nextTargetGroup)
    updateTargetMarkerScale()
    setGlobeReady(true)

    if (!isWebGL2Ref.current) {
      markCaptureReady()
      return
    }

    // Create persistent volume mesh for the attribution shell.
    const emptyTex = emptyVolume()
    emptyTexRef.current = emptyTex
    prevTexRef.current = emptyTex
    nextTexRef.current = emptyTex
    const defaultColorSchemeId = attributionColorSchemeId(DEFAULT_ATTRIBUTION_COLOR_SCHEME)

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexPrev: { value: emptyTex },
        uTexNext: { value: emptyTex },
        uMix: { value: 1.0 },
        uRInner: { value: R_INNER_FLAT },
        uROuter: { value: R_OUTER_FLAT },
        uSteps: { value: 32 },
        uAlpha: { value: ALPHA_FLAT },
        uSmoothing: { value: 0.0 },
        uDivergingPrev: { value: prevDivergingRef.current },
        uDivergingNext: { value: nextDivergingRef.current },
        uImportedFlatDivergingAlphaPrev: { value: prevImportedFlatDivergingAlphaRef.current },
        uImportedFlatDivergingAlphaNext: { value: nextImportedFlatDivergingAlphaRef.current },
        uImportedFlatSequentialAlphaPrev: { value: prevImportedFlatSequentialAlphaRef.current },
        uImportedFlatSequentialAlphaNext: { value: nextImportedFlatSequentialAlphaRef.current },
        uColorSchemePrev: { value: defaultColorSchemeId },
        uColorSchemeNext: { value: defaultColorSchemeId },
        uCustomColormapPrev: { value: colorSchemeTexture(DEFAULT_ATTRIBUTION_COLOR_SCHEME, diverging) },
        uCustomColormapNext: { value: colorSchemeTexture(DEFAULT_ATTRIBUTION_COLOR_SCHEME, diverging) },
        uDivergingBaseAlpha: { value: 0.0 },
        uContours: { value: false },
        uContourCount: { value: 8.0 },
        uInvProjectionView: { value: new THREE.Matrix4() },
        uViewport: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false, // render on top of globe surface
      side: THREE.BackSide, // render inner faces so ray enters from outside
      glslVersion: THREE.GLSL3,
    })
    materialRef.current = mat

    // Keep the raster proxy reasonably dense so its silhouette tracks the
    // analytic shell closely near the limb.
    const geo = new THREE.SphereGeometry(R_OUTER_FLAT, 96, 48)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 999 // render after globe tiles
    volumeMeshRef.current = mesh
    g.scene().add(mesh)

    const controls = g.controls() as GlobeControlsEvents | undefined
    controlsRef.current = controls ?? null
    controls?.addEventListener('change', updateRaymarchViewUniforms)
    controls?.addEventListener('change', updateTargetMarkerScale)
    updateRaymarchViewUniforms()
  }, [diverging, markCaptureReady, targetColor, updateRaymarchViewUniforms, updateTargetMarkerScale])

  // Cleanup material/geometry on unmount (cache is owned by App; overlay meshes
  // are owned and disposed by useGlobeOverlays).
  useEffect(() => {
    return () => {
      if (blendRafRef.current) cancelAnimationFrame(blendRafRef.current)
      if (targetBlendRafRef.current) cancelAnimationFrame(targetBlendRafRef.current)
      controlsRef.current?.removeEventListener('change', updateRaymarchViewUniforms)
      controlsRef.current?.removeEventListener('change', updateTargetMarkerScale)
      disposeTargetGroup(targetPrevGroupRef.current)
      disposeTargetGroup(targetNextGroupRef.current)
      const disposingMat = materialRef.current
      ;(disposingMat?.uniforms.uCustomColormapPrev.value as THREE.DataTexture | null)?.dispose()
      ;(disposingMat?.uniforms.uCustomColormapNext.value as THREE.DataTexture | null)?.dispose()
      disposingMat?.dispose()
      volumeMeshRef.current?.geometry.dispose()
      emptyTexRef.current?.dispose()
      emptyTexRef.current = null
    }
  }, [updateRaymarchViewUniforms, updateTargetMarkerScale])

  useEffect(() => {
    if (!globeReady) return
    updateRaymarchViewUniforms()
    updateTargetMarkerScale()
  }, [globeReady, dimensions, updateRaymarchViewUniforms, updateTargetMarkerScale])

  // Keep flat-shell uniforms synchronized after material creation.
  useEffect(() => {
    const mat = materialRef.current
    if (!mat) return
    mat.uniforms.uRInner.value = R_INNER_FLAT
    mat.uniforms.uROuter.value = R_OUTER_FLAT
    const hasExternalGridData = hasDenseGridData(externalGrids)
    mat.uniforms.uAlpha.value = (hasExternalGridData ? 0.95 : ALPHA_FLAT) * globalOpacity
    mat.uniforms.uSteps.value = hasExternalGridData ? 1 : 6
    mat.uniforms.uDivergingBaseAlpha.value = hasExternalGridData ? 0.03 : 0.0
  }, [globeReady, externalGrids, globalOpacity])

  // The flat shell does not apply cross-level smoothing.
  useEffect(() => {
    const mat = materialRef.current
    if (!mat) return
    mat.uniforms.uSmoothing.value = 0.0
  }, [globeReady])

  // Toggle contour-line depiction. globeReady included for the same reason as
  // the flat-shell effect above.
  useEffect(() => {
    const mat = materialRef.current
    if (!mat) return
    mat.uniforms.uContours.value = contours
  }, [contours, globeReady])

  useEffect(() => {
    if (!globeReady) return
    const color = normalizeTargetColor(targetColor)
    setTargetGroupColor(targetPrevGroupRef.current, color)
    setTargetGroupColor(targetNextGroupRef.current, color)
  }, [globeReady, targetColor])

  useEffect(() => {
    if (!globeReady || !globeRef.current) return

    const nextTarget = target ?? null
    const nextKey = targetSignature(nextTarget)
    if (nextKey === targetKeyRef.current) return
    targetKeyRef.current = nextKey

    const scene = globeRef.current.scene()
    const color = normalizeTargetColor(targetColor)
    const previousTarget = currentTargetRef.current
    currentTargetRef.current = nextTarget

    const oldPrevGroup = targetPrevGroupRef.current
    const oldNextGroup = targetNextGroupRef.current
    const newPrevGroup = buildTargetGroup(previousTarget, color)
    const newNextGroup = buildTargetGroup(nextTarget, color)
    targetPrevGroupRef.current = newPrevGroup
    targetNextGroupRef.current = newNextGroup
    scene.add(newPrevGroup)
    scene.add(newNextGroup)
    updateTargetMarkerScale()
    if (oldPrevGroup) scene.remove(oldPrevGroup)
    if (oldNextGroup) scene.remove(oldNextGroup)
    disposeTargetGroup(oldPrevGroup)
    disposeTargetGroup(oldNextGroup)

    if (targetBlendRafRef.current) {
      cancelAnimationFrame(targetBlendRafRef.current)
      targetBlendRafRef.current = 0
    }

    const animate = () => {
      const elapsed = performance.now() - startTime
      const mix = duration <= 0 ? 1 : Math.min(elapsed / duration, 1)
      setTargetGroupOpacity(newPrevGroup, previousTarget ? 1 - mix : 0)
      setTargetGroupOpacity(newNextGroup, nextTarget ? mix : 0)
      if (mix < 1) {
        targetBlendRafRef.current = requestAnimationFrame(animate)
      } else {
        targetBlendRafRef.current = 0
      }
    }

    const duration = Math.max(0, blendMs)
    const startTime = performance.now()
    animate()
  }, [blendMs, globeReady, target, targetColor, updateTargetMarkerScale])

  // Build/cache volume textures; the sequence keeps fast-scrub results ordered.
  const buildSeqRef = useRef(0)

  useEffect(() => {
    if (!isWebGL2Ref.current || !materialRef.current) return

    const plSig = VolumeCache.plSignature(pressureLevels)
    const hasExternalGridData = hasDenseGridData(externalGrids)
    const hasPointData = points.length > 0
    const hasFrameData = hasExternalGridData || hasPointData
    const denseGridMode = hasExternalGridData ? 'flat' : undefined
    const importedFlatDivergingAlpha = hasExternalGridData && diverging
    const importedFlatSequentialAlpha = hasExternalGridData && !diverging
    const volumeBuildMode = denseGridMode ?? (hasPointData ? 'points' : 'empty')
    const denseGridSmoothSigma = hasExternalGridData && smoothImportedGrids ? smoothImportedGridSigma.toFixed(2) : 'off'
    const colorSchemeSig = attributionColorSchemeSignature(colorScheme)
    const fullKey = `${frameKey}__${plSig}__${volumeBuildMode}__xy:${denseGridSmoothSigma}__${diverging ? 'diverging' : 'sequential'}__abs:${absolute ? 'on' : 'off'}__color:${colorSchemeSig}`
    if (fullKey === activeFrameKeyRef.current) return
    activeFrameKeyRef.current = fullKey

    const seq = ++buildSeqRef.current

    // Cancel any in-flight blend animation
    if (blendRafRef.current) {
      cancelAnimationFrame(blendRafRef.current)
      blendRafRef.current = 0
    }

    const mat = materialRef.current
    const cache = volumeCache
    const indicator = buildingIndicatorRef.current

    // Dispose old prev texture if it's no longer in the cache
    // (evicted textures aren't auto-disposed to avoid corrupting shader reads)
    const oldPrev = prevTexRef.current
    if (oldPrev && nextTexRef.current && oldPrev !== nextTexRef.current) {
      if (!cache.hasTexture(oldPrev)) {
        oldPrev.dispose()
      }
    }

    // Move current next → prev
    if (nextTexRef.current) {
      prevTexRef.current = nextTexRef.current
    }

    /** Start crossfade animation once texture is ready */
    function startBlend(newTex: THREE.Data3DTexture) {
      // Only accept the most recent build (skip stale out-of-order results)
      if (seq !== buildSeqRef.current) return

      // Cancel any lingering animation from a previous blend
      if (blendRafRef.current) {
        cancelAnimationFrame(blendRafRef.current)
        blendRafRef.current = 0
      }

      nextTexRef.current = newTex

      // First ever texture: show immediately so the empty placeholder (all-zero
      // → deep blue in diverging mode) never appears on screen.
      if (!hasRealDataRef.current) {
        hasRealDataRef.current = true
        prevDivergingRef.current = diverging
        nextDivergingRef.current = diverging
        prevColorSchemeRef.current = colorScheme
        nextColorSchemeRef.current = colorScheme
        prevImportedFlatDivergingAlphaRef.current = importedFlatDivergingAlpha
        nextImportedFlatDivergingAlphaRef.current = importedFlatDivergingAlpha
        prevImportedFlatSequentialAlphaRef.current = importedFlatSequentialAlpha
        nextImportedFlatSequentialAlphaRef.current = importedFlatSequentialAlpha
        mat.uniforms.uTexPrev.value = newTex
        mat.uniforms.uTexNext.value = newTex
        mat.uniforms.uDivergingPrev.value = diverging
        mat.uniforms.uDivergingNext.value = diverging
        applyColorSchemeUniforms(mat, 'Prev', colorScheme, diverging)
        applyColorSchemeUniforms(mat, 'Next', colorScheme, diverging)
        mat.uniforms.uImportedFlatDivergingAlphaPrev.value = importedFlatDivergingAlpha
        mat.uniforms.uImportedFlatDivergingAlphaNext.value = importedFlatDivergingAlpha
        mat.uniforms.uImportedFlatSequentialAlphaPrev.value = importedFlatSequentialAlpha
        mat.uniforms.uImportedFlatSequentialAlphaNext.value = importedFlatSequentialAlpha
        mat.uniforms.uMix.value = 1.0
        markCaptureReady()
        return
      }

      prevDivergingRef.current = nextDivergingRef.current
      nextDivergingRef.current = diverging
      prevColorSchemeRef.current = nextColorSchemeRef.current
      nextColorSchemeRef.current = colorScheme
      prevImportedFlatDivergingAlphaRef.current = nextImportedFlatDivergingAlphaRef.current
      nextImportedFlatDivergingAlphaRef.current = importedFlatDivergingAlpha
      prevImportedFlatSequentialAlphaRef.current = nextImportedFlatSequentialAlphaRef.current
      nextImportedFlatSequentialAlphaRef.current = importedFlatSequentialAlpha
      mat.uniforms.uTexPrev.value = prevTexRef.current
      mat.uniforms.uTexNext.value = newTex
      mat.uniforms.uDivergingPrev.value = prevDivergingRef.current
      mat.uniforms.uDivergingNext.value = nextDivergingRef.current
      applyColorSchemeUniforms(mat, 'Prev', prevColorSchemeRef.current, prevDivergingRef.current)
      applyColorSchemeUniforms(mat, 'Next', nextColorSchemeRef.current, nextDivergingRef.current)
      mat.uniforms.uImportedFlatDivergingAlphaPrev.value = prevImportedFlatDivergingAlphaRef.current
      mat.uniforms.uImportedFlatDivergingAlphaNext.value = nextImportedFlatDivergingAlphaRef.current
      mat.uniforms.uImportedFlatSequentialAlphaPrev.value = prevImportedFlatSequentialAlphaRef.current
      mat.uniforms.uImportedFlatSequentialAlphaNext.value = nextImportedFlatSequentialAlphaRef.current
      mat.uniforms.uMix.value = 0

      const startTime = performance.now()
      const duration = blendMs

      function animate() {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        mat.uniforms.uMix.value = t
        if (t < 1) {
          blendRafRef.current = requestAnimationFrame(animate)
        } else {
          blendRafRef.current = 0
          markCaptureReady()
        }
      }
      blendRafRef.current = requestAnimationFrame(animate)
    }

    /** Prefetch next frame into the cache (fire-and-forget) */
    function prefetchNext() {
      if (!nextFrameKey) return

      if (hasDenseGridData(nextExternalGrids)) {
        cache.getOrBuildFromGrids(
          nextFrameKey,
          nextExternalGrids,
          pressureLevels,
          {
            diverging,
            smoothEnabled: smoothImportedGrids,
            smoothSigma: smoothImportedGridSigma,
            absolute,
          },
        )
        return
      }

      if (nextPoints && nextPoints.length > 0) {
        cache.getOrBuild(nextFrameKey, nextPoints, pressureLevels)
      }
    }

    function showEmptyFrame() {
      if (seq !== buildSeqRef.current) return

      if (blendRafRef.current) {
        cancelAnimationFrame(blendRafRef.current)
        blendRafRef.current = 0
      }

      const emptyTex = emptyTexRef.current
      if (!emptyTex) return

      const oldPrev = prevTexRef.current
      const oldNext = nextTexRef.current
      if (oldPrev && oldPrev !== emptyTex && oldPrev !== oldNext && !cache.hasTexture(oldPrev)) {
        oldPrev.dispose()
      }
      if (oldNext && oldNext !== emptyTex && !cache.hasTexture(oldNext)) {
        oldNext.dispose()
      }

      prevTexRef.current = emptyTex
      nextTexRef.current = emptyTex
      hasRealDataRef.current = false
      prevDivergingRef.current = false
      nextDivergingRef.current = false
      prevColorSchemeRef.current = DEFAULT_ATTRIBUTION_COLOR_SCHEME
      nextColorSchemeRef.current = DEFAULT_ATTRIBUTION_COLOR_SCHEME
      prevImportedFlatDivergingAlphaRef.current = false
      nextImportedFlatDivergingAlphaRef.current = false
      prevImportedFlatSequentialAlphaRef.current = false
      nextImportedFlatSequentialAlphaRef.current = false
      mat.uniforms.uTexPrev.value = emptyTex
      mat.uniforms.uTexNext.value = emptyTex
      mat.uniforms.uDivergingPrev.value = false
      mat.uniforms.uDivergingNext.value = false
      applyColorSchemeUniforms(mat, 'Prev', DEFAULT_ATTRIBUTION_COLOR_SCHEME, false)
      applyColorSchemeUniforms(mat, 'Next', DEFAULT_ATTRIBUTION_COLOR_SCHEME, false)
      mat.uniforms.uImportedFlatDivergingAlphaPrev.value = false
      mat.uniforms.uImportedFlatDivergingAlphaNext.value = false
      mat.uniforms.uImportedFlatSequentialAlphaPrev.value = false
      mat.uniforms.uImportedFlatSequentialAlphaNext.value = false
      mat.uniforms.uMix.value = 1.0
      if (indicator) indicator.hidden = true
      markCaptureReady()
    }

    if (!hasFrameData) {
      showEmptyFrame()
      prefetchNext()
      return
    }

    // getOrBuild returns cached texture synchronously, or a Promise for worker-built misses.
    const result = hasExternalGridData
      ? cache.getOrBuildFromGrids(
          frameKey,
          externalGrids,
          pressureLevels,
          {
            diverging,
            smoothEnabled: smoothImportedGrids,
            smoothSigma: smoothImportedGridSigma,
            absolute,
          },
        )
      : cache.getOrBuild(frameKey, points, pressureLevels)
    if (result instanceof Promise) {
      if (indicator) indicator.hidden = false
      result.then((tex) => {
        if (indicator) indicator.hidden = true
        startBlend(tex)
        prefetchNext()
      })
    } else {
      if (indicator) indicator.hidden = true
      startBlend(result)
      prefetchNext()
    }
  }, [globeReady, frameKey, pressureLevels, points, externalGrids, blendMs, nextFrameKey, nextPoints, nextExternalGrids, volumeCache, diverging, absolute, colorScheme, smoothImportedGrids, smoothImportedGridSigma, markCaptureReady])

  // Weather-field overlay meshes (owns its own registry + disposal).
  useGlobeOverlays(globeRef, globeReady, { overlays, overlayStates, overlayFrameIndex, blendMs })

  // Pause/resume Three.js render loop when view is hidden to save GPU
  useEffect(() => {
    if (!globeRef.current || !globeReady) return
    if (isActive) {
      globeRef.current.resumeAnimation()
    } else {
      globeRef.current.pauseAnimation()
    }
  }, [isActive, globeReady])

  // Camera animation on button zoom
  useEffect(() => {
    if (!didMountRef.current || !globeRef.current) return
    const { lat, lng } = globeRef.current.pointOfView()
    globeRef.current.pointOfView({ lat, lng, altitude: DEFAULT_ALTITUDE / cameraZoom }, 400)
  }, [cameraZoom])

  // Imperative camera move (for view sync during transitions)
  useEffect(() => {
    if (!requestedView || !globeRef.current || !globeReady) return
    const { lat, lng, altitude, durationMs } = requestedView
    globeRef.current.pointOfView({ lat, lng, altitude }, durationMs)
  }, [requestedView, globeReady])

  // Map type change → clear tiles + nudge
  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    g.globeTileEngineClearCache()
    const { lat, lng, altitude } = g.pointOfView()
    g.pointOfView({ lat, lng, altitude: altitude + 1e-7 }, 0)
  }, [mapType])

  // Scroll/pinch zoom → display only
  const handleZoom = useCallback(
    (pov: { lat: number; lng: number; altitude: number }) => {
      updateRaymarchViewUniforms()
      onZoomChange(Math.min(MAX_GLOBE_ZOOM, Math.max(MIN_GLOBE_ZOOM, DEFAULT_ALTITUDE / pov.altitude)))
      onViewChangeRef.current?.(pov.lat, pov.lng, pov.altitude)
    },
    [onZoomChange, updateRaymarchViewUniforms],
  )

  // WebGL1 fallback: use globe.gl heatmaps (no crossfade)
  const useHeatmapFallback = !isWebGL2
  const heatmapsData = useHeatmapFallback
    ? pressureLevels
        .filter((pl) => pl.visible && pl.opacity > 0)
        .map((pl, i) => ({
          id: pl.id,
          points: points.filter((p) => p.pressureLevelId === pl.id),
          baseAltitude: 0.001 * i,
          topAltitude: 0.001 * i + 0.001,
          opacity: pl.opacity,
        }))
        .filter((layer) => layer.points.length > 0)
    : [] // WebGL2: volume renderer handles everything

  return (
    <div ref={containerRef} className="absolute inset-0">
      {dimensions.width > 0 && (
        <GlobeGL
          ref={globeRef}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="rgba(0,0,0,0)"
          rendererConfig={GLOBE_RENDERER_CONFIG}
          globeImageUrl={null}
          bumpImageUrl={null}
          globeTileEngineUrl={TILE_URLS[mapType]}
          showAtmosphere={mapType === 'satellite'}
          atmosphereColor="#3a82f7"
          atmosphereAltitude={0.12}
          showGraticules={mapType === 'topo'}
          heatmapsData={heatmapsData}
          heatmapPoints="points"
          heatmapPointLat="y"
          heatmapPointLng="x"
          heatmapPointWeight="intensity"
          heatmapBandwidth={2.5}
          heatmapColorFn={(d: object) => {
            const layer = d as { opacity: number }
            const op = layer.opacity ?? 0.8
            const count = heatmapsData.length
            return (t: number) => heatmapColor(t, op, count)
          }}
          heatmapBaseAltitude="baseAltitude"
          heatmapTopAltitude="topAltitude"
          heatmapsTransitionDuration={0}
          enablePointerInteraction={false}
          onGlobeReady={handleGlobeReady}
          onZoom={handleZoom}
        />
      )}
      <div
        ref={buildingIndicatorRef}
        hidden
        className="absolute bottom-4 right-4 z-10 bg-card text-xs text-muted-foreground px-3 py-1.5 rounded-full border border-border/50"
      >
        Building frame…
      </div>
      <BasemapAttribution mapType={mapType} />
    </div>
  )
}

export default memo(GlobeViewInner)
