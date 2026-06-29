/**
 * MapLibre CustomLayerInterface that renders the attribution overlay
 * using a Three.js renderer sharing MapLibre's WebGL context.
 *
 * This mirrors the globe renderer's architecture:
 *   - THREE.BoxGeometry with BackSide rendering (same pattern as the globe's sphere)
 *   - Front-to-back compositing with crossfade between frames
 *   - Cached volume textures used directly (no re-upload)
 */

import * as THREE from 'three'
import { type CustomLayerInterface, type Map as MapLibreMap, type CustomRenderMethodInput } from 'maplibre-gl'
import type { AttributionColorScheme, AttributionPoint, DenseLevelGrid, PressureLevel } from '@/types'
import {
  attributionColorSchemeId,
  attributionColorSchemeSignature,
  attributionRampStops,
  DEFAULT_ATTRIBUTION_COLOR_SCHEME,
} from '@/lib/attributionColor'
import { buildOverlayColormapTexture } from '@/lib/overlayColor'
import { VolumeCache } from '@/globe/volumeCache'
import { mapVolumeVertexShader, mapVolumeFragmentShader } from './shaders'

export interface VolumeOverlayOptions {
  volumeCache: VolumeCache
  getFrameKey: () => string
  getPoints: () => AttributionPoint[]
  getPressureLevels: () => PressureLevel[]
  getBlendMs: () => number
  getNextFrameKey: () => string | undefined
  getNextPoints: () => AttributionPoint[] | undefined
  getNextExternalGrids: () => Record<string, DenseLevelGrid> | null | undefined
  /** Apply XY Gaussian-like smoothing to imported dense grids */
  getSmoothImportedGrids: () => boolean
  /** Gaussian sigma used for imported dense-grid smoothing */
  getSmoothImportedGridSigma: () => number
  /** Dense grids for the currently selected method (overrides sparse points path) */
  getExternalGrids: () => Record<string, DenseLevelGrid> | null | undefined
  /** When true, activate diverging colormap */
  getDiverging: () => boolean
  /** When true, fold diverging data to absolute magnitude (sequential render) */
  getAbsolute: () => boolean
  /** Attribution color scheme for the selected method */
  getColorScheme: () => AttributionColorScheme
  /** When true, render attribution as contour isolines instead of a filled heatmap */
  getContours: () => boolean
  getGlobalOpacity: () => number
}

// Build the 256×1 LUT the shader samples for ALL colormaps (preset + custom).
// `diverging` only affects the `default` preset (RdBu_r vs the warm ramp).
function colorSchemeTexture(
  scheme: AttributionColorScheme,
  diverging: boolean,
): THREE.DataTexture {
  return buildOverlayColormapTexture(attributionRampStops(scheme, diverging))
}

function applyColorSchemeUniforms(
  material: THREE.ShaderMaterial,
  suffix: 'Prev' | 'Next',
  scheme: AttributionColorScheme,
  diverging: boolean,
) {
  material.uniforms[`uColorScheme${suffix}`].value = attributionColorSchemeId(scheme)
  const uniform = material.uniforms[`uCustomColormap${suffix}`]
  const previous = uniform.value as THREE.DataTexture | null
  uniform.value = colorSchemeTexture(scheme, diverging)
  previous?.dispose()
}

/** Create an empty 1x1x1 placeholder texture */
function emptyVolume(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function hasDenseGridData(
  grids: Record<string, DenseLevelGrid> | null | undefined,
): grids is Record<string, DenseLevelGrid> {
  return !!grids && Object.keys(grids).length > 0
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVolumeOverlayLayer(opts: VolumeOverlayOptions): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.Camera | null = null
  let mesh: THREE.Mesh | null = null
  let material: THREE.ShaderMaterial | null = null
  let mapRef: MapLibreMap | null = null

  // Texture / crossfade state
  const empty = emptyVolume()
  let prevTex: THREE.Data3DTexture = empty
  let nextTex: THREE.Data3DTexture = empty
  let activeKey = ''
  let prevDiverging = false
  let nextDiverging = false
  let prevColorScheme: AttributionColorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME
  let nextColorScheme: AttributionColorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME
  let prevImportedFlatDivergingAlpha = false
  let nextImportedFlatDivergingAlpha = false
  let prevImportedFlatSequentialAlpha = false
  let nextImportedFlatSequentialAlpha = false
  let buildSeq = 0
  let blendStartTime = -1
  let blendDuration = 500
  let mixValue = 1.0

  return {
    id: 'volume-overlay',
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      mapRef = map

      // Share MapLibre's GL context with Three.js
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
      })
      renderer.autoClear = false

      scene = new THREE.Scene()

      // Camera with identity view matrix — projectionMatrix receives the
      // full MapLibre MVP each frame, so modelMatrix alone maps local
      // vertices into Mercator-pixel world space.
      camera = new THREE.Camera()
      const defaultColorSchemeId = attributionColorSchemeId(DEFAULT_ATTRIBUTION_COLOR_SCHEME)

      material = new THREE.ShaderMaterial({
        vertexShader: mapVolumeVertexShader,
        fragmentShader: mapVolumeFragmentShader,
        uniforms: {
          uTexPrev:   { value: empty },
          uTexNext:   { value: empty },
          uMix:       { value: 1.0 },
          uAlpha:     { value: 0.7 },
          uSteps:     { value: 6 },
          uWorldSize: { value: 512.0 },
          uSmoothing:  { value: 0.5 },
          uDivergingPrev: { value: false },
          uDivergingNext: { value: false },
          uImportedFlatDivergingAlphaPrev: { value: false },
          uImportedFlatDivergingAlphaNext: { value: false },
          uImportedFlatSequentialAlphaPrev: { value: false },
          uImportedFlatSequentialAlphaNext: { value: false },
          uColorSchemePrev: { value: defaultColorSchemeId },
          uColorSchemeNext: { value: defaultColorSchemeId },
          uCustomColormapPrev: { value: colorSchemeTexture(DEFAULT_ATTRIBUTION_COLOR_SCHEME, false) },
          uCustomColormapNext: { value: colorSchemeTexture(DEFAULT_ATTRIBUTION_COLOR_SCHEME, false) },
          uDivergingBaseAlpha: { value: 0.0 },
          uContours: { value: false },
          uContourCount: { value: 8.0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,   // same as globe: render inner faces
        glslVersion: THREE.GLSL3,
      })

      // Single unit-box mesh repositioned as a world-spanning thin slab.
      const geo = new THREE.BoxGeometry(1, 1, 1)
      mesh = new THREE.Mesh(geo, material)
      mesh.frustumCulled = false
      scene.add(mesh)
    },

    render(_gl, options: CustomRenderMethodInput) {
      if (!renderer || !scene || !camera || !material || !mesh || !mapRef) return

      // ---- 1. Handle frame / pressure-level changes ----
      const frameKey = opts.getFrameKey()
      const pressureLevels = opts.getPressureLevels()
      const targetDiverging = opts.getDiverging()
      const targetAbsolute = opts.getAbsolute()
      const targetColorScheme = opts.getColorScheme()
      const externalGrids = opts.getExternalGrids()
      const hasExternalGridData = hasDenseGridData(externalGrids)
      const points = opts.getPoints()
      const hasPointData = points.length > 0
      const hasFrameData = hasExternalGridData || hasPointData
      const denseGridMode = hasExternalGridData ? 'flat' : undefined
      // Imported-grid transfer functions use the data-native alpha path; the
      // legacy rainbow ramp and density-squared alpha are only for demo points.
      const importedFlatDivergingAlpha = hasExternalGridData && targetDiverging
      const importedFlatSequentialAlpha = hasExternalGridData && !targetDiverging
      const volumeBuildMode = denseGridMode ?? (hasPointData ? 'points' : 'empty')
      const denseGridSmoothSigma = hasExternalGridData && opts.getSmoothImportedGrids() ? opts.getSmoothImportedGridSigma().toFixed(2) : 'off'
      const colorSchemeSig = attributionColorSchemeSignature(targetColorScheme)
      const newKey = `${VolumeCache.cacheKey(frameKey, pressureLevels)}__${volumeBuildMode}__xy:${denseGridSmoothSigma}__${targetDiverging ? 'diverging' : 'sequential'}__abs:${targetAbsolute ? 'on' : 'off'}__color:${colorSchemeSig}`

      if (newKey !== activeKey) {
        activeKey = newKey
        const seq = ++buildSeq

        const releaseTexture = (tex: THREE.Data3DTexture) => {
          if (tex !== empty && !opts.volumeCache.hasTexture(tex)) {
            tex.dispose()
          }
        }

        const prefetchNext = () => {
          const nfk = opts.getNextFrameKey()
          if (!nfk) return

          const nextExternalGrids = opts.getNextExternalGrids()
          if (hasDenseGridData(nextExternalGrids)) {
            opts.volumeCache.getOrBuildFromGrids(
              nfk,
              nextExternalGrids,
              pressureLevels,
              {
                diverging: targetDiverging,
                smoothEnabled: opts.getSmoothImportedGrids(),
                smoothSigma: opts.getSmoothImportedGridSigma(),
                absolute: targetAbsolute,
              },
            )
            return
          }

          const np = opts.getNextPoints()
          if (np?.length) {
            opts.volumeCache.getOrBuild(nfk, np, pressureLevels)
          }
        }

        const showEmptyFrame = () => {
          if (seq !== buildSeq) return

          const oldPrev = prevTex
          const oldNext = nextTex
          if (oldPrev !== empty && oldPrev !== oldNext) releaseTexture(oldPrev)
          if (oldNext !== empty) releaseTexture(oldNext)

          prevTex = empty
          nextTex = empty
          prevDiverging = false
          nextDiverging = false
          prevColorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME
          nextColorScheme = DEFAULT_ATTRIBUTION_COLOR_SCHEME
          prevImportedFlatDivergingAlpha = false
          nextImportedFlatDivergingAlpha = false
          prevImportedFlatSequentialAlpha = false
          nextImportedFlatSequentialAlpha = false
          material!.uniforms.uTexPrev.value = empty
          material!.uniforms.uTexNext.value = empty
          material!.uniforms.uDivergingPrev.value = false
          material!.uniforms.uDivergingNext.value = false
          applyColorSchemeUniforms(material!, 'Prev', DEFAULT_ATTRIBUTION_COLOR_SCHEME, false)
          applyColorSchemeUniforms(material!, 'Next', DEFAULT_ATTRIBUTION_COLOR_SCHEME, false)
          material!.uniforms.uImportedFlatDivergingAlphaPrev.value = false
          material!.uniforms.uImportedFlatDivergingAlphaNext.value = false
          material!.uniforms.uImportedFlatSequentialAlphaPrev.value = false
          material!.uniforms.uImportedFlatSequentialAlphaNext.value = false
          mixValue = 1.0
          blendStartTime = -1
          mapRef?.triggerRepaint()
        }

        const startBlend = (newTex: THREE.Data3DTexture) => {
          if (seq !== buildSeq) return

          const oldPrev = prevTex
          if (oldPrev !== empty && nextTex !== empty && oldPrev !== nextTex) {
            if (!opts.volumeCache.hasTexture(oldPrev)) {
              oldPrev.dispose()
            }
          }

          // First ever texture: the previous state was the empty placeholder (all-zero
          // → deep blue in diverging mode). Show the real texture immediately.
          const isFirstLoad = nextTex === empty
          prevTex = nextTex
          prevDiverging = nextDiverging
          prevColorScheme = nextColorScheme
          prevImportedFlatDivergingAlpha = nextImportedFlatDivergingAlpha
          prevImportedFlatSequentialAlpha = nextImportedFlatSequentialAlpha
          nextTex = newTex
          nextDiverging = targetDiverging
          nextColorScheme = targetColorScheme
          nextImportedFlatDivergingAlpha = importedFlatDivergingAlpha
          nextImportedFlatSequentialAlpha = importedFlatSequentialAlpha

          if (isFirstLoad) {
            material!.uniforms.uTexPrev.value = newTex
            material!.uniforms.uTexNext.value = newTex
            material!.uniforms.uDivergingPrev.value = targetDiverging
            material!.uniforms.uDivergingNext.value = targetDiverging
            applyColorSchemeUniforms(material!, 'Prev', targetColorScheme, targetDiverging)
            applyColorSchemeUniforms(material!, 'Next', targetColorScheme, targetDiverging)
            material!.uniforms.uImportedFlatDivergingAlphaPrev.value = importedFlatDivergingAlpha
            material!.uniforms.uImportedFlatDivergingAlphaNext.value = importedFlatDivergingAlpha
            material!.uniforms.uImportedFlatSequentialAlphaPrev.value = importedFlatSequentialAlpha
            material!.uniforms.uImportedFlatSequentialAlphaNext.value = importedFlatSequentialAlpha
            mixValue = 1.0
            blendStartTime = -1
            mapRef?.triggerRepaint()
            prefetchNext()
            return
          }

          material!.uniforms.uTexPrev.value = prevTex
          material!.uniforms.uTexNext.value = nextTex
          material!.uniforms.uDivergingPrev.value = prevDiverging
          material!.uniforms.uDivergingNext.value = nextDiverging
          applyColorSchemeUniforms(material!, 'Prev', prevColorScheme, prevDiverging)
          applyColorSchemeUniforms(material!, 'Next', nextColorScheme, nextDiverging)
          material!.uniforms.uImportedFlatDivergingAlphaPrev.value = prevImportedFlatDivergingAlpha
          material!.uniforms.uImportedFlatDivergingAlphaNext.value = nextImportedFlatDivergingAlpha
          material!.uniforms.uImportedFlatSequentialAlphaPrev.value = prevImportedFlatSequentialAlpha
          material!.uniforms.uImportedFlatSequentialAlphaNext.value = nextImportedFlatSequentialAlpha

          mixValue = 0
          blendStartTime = performance.now()
          blendDuration = opts.getBlendMs()
          mapRef?.triggerRepaint()

          prefetchNext()
        }

        if (!hasFrameData) {
          showEmptyFrame()
          prefetchNext()
        } else {
          let result: THREE.Data3DTexture | Promise<THREE.Data3DTexture>
          if (hasExternalGridData) {
            result = opts.volumeCache.getOrBuildFromGrids(
              frameKey,
              externalGrids,
              pressureLevels,
              {
                diverging: targetDiverging,
                smoothEnabled: opts.getSmoothImportedGrids(),
                smoothSigma: opts.getSmoothImportedGridSigma(),
                absolute: targetAbsolute,
              },
            )
          } else {
            result = opts.volumeCache.getOrBuild(frameKey, points, pressureLevels)
          }
          if (result instanceof Promise) {
            result.then(startBlend)
          } else {
            startBlend(result)
          }
        }
      }

      // ---- 2. Advance crossfade ----
      if (blendStartTime >= 0) {
        const elapsed = performance.now() - blendStartTime
        mixValue = Math.min(elapsed / blendDuration, 1)
        if (mixValue < 1) {
          mapRef.triggerRepaint()
        } else {
          blendStartTime = -1
        }
      }

      // ---- 3. Update camera, uniforms, mesh geometry ----
      const worldSize = mapRef.transform.worldSize

      // Camera: projectionMatrix = full MapLibre MVP
      camera.projectionMatrix.fromArray(options.modelViewProjectionMatrix)

      material.uniforms.uWorldSize.value = worldSize
      material.uniforms.uMix.value = mixValue
      const hasCurrentExternalGrids = hasDenseGridData(opts.getExternalGrids())
      material.uniforms.uAlpha.value = (hasCurrentExternalGrids ? 1.0 : 0.7) * opts.getGlobalOpacity()
      material.uniforms.uSteps.value = hasCurrentExternalGrids ? 1 : 6
      material.uniforms.uSmoothing.value = 0.0
      // Legacy diverging paths still use uDivergingBaseAlpha; imported flat diverging
      // grids now switch to a separate transfer function in the shared shader.
      material.uniforms.uDivergingBaseAlpha.value = hasCurrentExternalGrids ? 0.03 : 0.0
      material.uniforms.uContours.value = opts.getContours()

      mesh.position.set(worldSize / 2, worldSize / 2, 0.5)
      mesh.scale.set(worldSize, worldSize, 1)
      material.depthTest = false

      // ---- 4. Render via Three.js (shared GL context) ----
      renderer.resetState()
      renderer.render(scene, camera)
      // Restore WebGL state for any regular MapLibre layers rendered after this
      // custom layer (for example the target overlay line/fill/circle layers).
      renderer.resetState()
    },

    onRemove() {
      if (prevTex !== empty && !opts.volumeCache.hasTexture(prevTex)) {
        prevTex.dispose()
      }
      if (nextTex !== empty && nextTex !== prevTex && !opts.volumeCache.hasTexture(nextTex)) {
        nextTex.dispose()
      }
      empty.dispose()
      ;(material?.uniforms.uCustomColormapPrev.value as THREE.DataTexture | null)?.dispose()
      ;(material?.uniforms.uCustomColormapNext.value as THREE.DataTexture | null)?.dispose()
      material?.dispose()
      mesh?.geometry.dispose()
      // Do NOT dispose renderer — it shares MapLibre's GL context.
      // Just drop references so GC can collect.
      renderer = null
      scene = null
      camera = null
      mesh = null
      material = null
      mapRef = null
    },
  }
}
