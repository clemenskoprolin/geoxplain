/**
 * MapLibre custom layer for flat weather-field overlays.
 *
 * Each overlay slug owns one mesh/material/texture pair in a Three.js scene that
 * shares MapLibre's GL context. Data-frame fades (`uMix`) and appearance fades
 * (`uAppearanceMix`) run independently, so opacity or colormap changes do not
 * interrupt playback.
 */

import * as THREE from 'three'
import type { CustomLayerInterface, Map as MapLibreMap, CustomRenderMethodInput } from 'maplibre-gl'
import type { OverlayColorStop, OverlayColormap, OverlayData, OverlayLayerState } from '@/types'
import { buildOverlayColormapTexture, overlayColormapId, overlayStopsSignature } from '@/lib/overlayColor'
import { overlayVertexShader, overlayFragmentShader } from './overlayShaders'

export interface OverlaysLayerOptions {
  getOverlays: () => Record<string, OverlayData> | null | undefined
  getOverlayStates: () => OverlayLayerState[]
  getFrameIndex: () => number
  getBlendMs: () => number
}

interface MeshEntry {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  // Data-frame crossfade (uMix) — independent timeline.
  prevTexture: THREE.DataTexture
  nextTexture: THREE.DataTexture
  frameMix: number
  frameBlendStart: number   // -1 when idle
  frameBlendDuration: number
  // Appearance crossfade (uAppearanceMix) — independent timeline.
  prevColormapTexture: THREE.DataTexture
  nextColormapTexture: THREE.DataTexture
  prevAppearance: OverlayAppearance
  nextAppearance: OverlayAppearance
  appearanceMix: number
  appearanceBlendStart: number  // -1 when idle
  appearanceBlendDuration: number
  disposeAfterAppearanceBlend: boolean
  loadedFrameKey: string   // slug + ':' + frameIndex to detect when texture needs refresh
  loadedAppearanceKey: string
}

interface OverlayAppearance {
  opacity: number
  colormap: OverlayColormap
  useCustomColormap: boolean
  stretchLow: number
  stretchHigh: number
  colormapKey: string
}

function buildTexture(dataU8: Uint8Array, width: number, height: number): THREE.DataTexture {
  // THREE.DataTexture needs a copy — the source Uint8Array is owned by the caller
  const data = new Uint8Array(dataU8)
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}

function overlayAppearanceKey(appearance: OverlayAppearance): string {
  return [
    appearance.opacity.toFixed(4),
    appearance.colormap,
    appearance.useCustomColormap ? 'custom' : 'preset',
    appearance.colormapKey,
    appearance.stretchLow.toFixed(4),
    appearance.stretchHigh.toFixed(4),
  ].join(':')
}

function overlayAppearance(
  overlayData: OverlayData,
  state: OverlayLayerState | undefined,
  opacity: number,
): { appearance: OverlayAppearance; customStops?: OverlayColorStop[] } {
  const colormap = state?.colormap ?? overlayData.colormap
  const customStops = colormap === 'custom' ? overlayData.colormapStops : undefined
  const useCustomColormap = !!customStops?.length
  return {
    appearance: {
      opacity,
      colormap,
      useCustomColormap,
      stretchLow: state?.stretchLow ?? 0,
      stretchHigh: state?.stretchHigh ?? 1,
      colormapKey: useCustomColormap ? overlayStopsSignature(customStops) : '',
    },
    customStops,
  }
}

function applyAppearanceUniforms(
  material: THREE.ShaderMaterial,
  suffix: 'Prev' | 'Next',
  appearance: OverlayAppearance,
) {
  material.uniforms[`uOpacity${suffix}`].value = appearance.opacity
  material.uniforms[`uColormap${suffix}`].value = overlayColormapId(appearance.colormap)
  material.uniforms[`uUseCustomColormap${suffix}`].value = appearance.useCustomColormap
  material.uniforms[`uStretchLow${suffix}`].value = appearance.stretchLow
  material.uniforms[`uStretchHigh${suffix}`].value = appearance.stretchHigh
}

/** Push the entry's full prev/next state (both crossfades) to the material. */
function applyEntryUniforms(entry: MeshEntry) {
  entry.material.uniforms.uTexPrev.value = entry.prevTexture
  entry.material.uniforms.uTexNext.value = entry.nextTexture
  entry.material.uniforms.uMix.value = entry.frameMix
  entry.material.uniforms.uCustomColormapPrev.value = entry.prevColormapTexture
  entry.material.uniforms.uCustomColormapNext.value = entry.nextColormapTexture
  entry.material.uniforms.uAppearanceMix.value = entry.appearanceMix
  applyAppearanceUniforms(entry.material, 'Prev', entry.prevAppearance)
  applyAppearanceUniforms(entry.material, 'Next', entry.nextAppearance)
}

export function createOverlaysLayer(opts: OverlaysLayerOptions): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.Camera | null = null
  let mapRef: MapLibreMap | null = null

  // slug → MeshEntry
  const entries = new Map<string, MeshEntry>()
  // Shared flat-slab geometry (unit box, thin in Z; scaled to worldSize each frame)
  let slabGeo: THREE.BoxGeometry | null = null

  function disposeMeshEntry(entry: MeshEntry) {
    const textures = new Set([
      entry.prevTexture,
      entry.nextTexture,
      entry.prevColormapTexture,
      entry.nextColormapTexture,
    ])
    textures.forEach((texture) => texture.dispose())
    entry.material.dispose()
    // geometry is shared; don't dispose it here
    scene?.remove(entry.mesh)
  }

  /** Start the data-frame crossfade only (does not touch the appearance timeline). */
  function startFrameBlend(entry: MeshEntry, nextTexture: THREE.DataTexture, frameKey: string) {
    if (entry.prevTexture !== entry.nextTexture) {
      entry.prevTexture.dispose()
    }
    entry.prevTexture = entry.nextTexture
    entry.nextTexture = nextTexture
    entry.frameMix = 0
    entry.frameBlendStart = performance.now()
    entry.frameBlendDuration = Math.max(0, opts.getBlendMs())
    entry.loadedFrameKey = frameKey
  }

  /** Start the appearance crossfade only (does not touch the data-frame timeline). */
  function startAppearanceBlend(
    entry: MeshEntry,
    appearance: OverlayAppearance,
    customStops: OverlayColorStop[] | undefined,
    disposeAfterBlend: boolean,
  ) {
    if (entry.prevColormapTexture !== entry.nextColormapTexture) {
      entry.prevColormapTexture.dispose()
    }
    entry.prevColormapTexture = entry.nextColormapTexture
    entry.prevAppearance = entry.nextAppearance
    entry.nextColormapTexture = buildOverlayColormapTexture(customStops)
    entry.nextAppearance = appearance
    entry.appearanceMix = 0
    entry.appearanceBlendStart = performance.now()
    entry.appearanceBlendDuration = Math.max(0, opts.getBlendMs())
    entry.disposeAfterAppearanceBlend = disposeAfterBlend
    entry.loadedAppearanceKey = overlayAppearanceKey(appearance)
  }

  return {
    id: 'overlays-layer',
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      mapRef = map

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
      })
      renderer.autoClear = false

      scene = new THREE.Scene()
      camera = new THREE.Camera()
      slabGeo = new THREE.BoxGeometry(1, 1, 1)
    },

    render(_gl, options: CustomRenderMethodInput) {
      if (!renderer || !scene || !camera || !mapRef || !slabGeo) return

      const overlays = opts.getOverlays()
      const states = opts.getOverlayStates()
      const frameIndex = opts.getFrameIndex()
      const worldSize = mapRef.transform.worldSize

      const stateBySlug = new Map(states.map((s) => [s.slug, s]))
      const activeSlugSet = new Set<string>()

      if (overlays) {
        for (const [slug, overlayData] of Object.entries(overlays)) {
          const state = stateBySlug.get(slug)
          const visible = state?.visible ?? true
          const opacity = visible ? (state?.opacity ?? 0.7) : 0
          const { appearance, customStops } = overlayAppearance(overlayData, state, opacity)
          const appearanceKey = overlayAppearanceKey(appearance)
          const existingEntry = entries.get(slug)

          if (appearance.opacity < 0.01 && !existingEntry) continue
          if (overlayData.frames.length === 0) continue

          const clampedIndex = Math.min(frameIndex, overlayData.frames.length - 1)
          const frame = overlayData.frames[clampedIndex]
          if (!frame) continue

          activeSlugSet.add(slug)
          const frameKey = `${slug}:${clampedIndex}:${frame.shape[0]}x${frame.shape[1]}`

          let entry = existingEntry

          if (!entry) {
            // New mesh for this slug. Data shown immediately (uMix = 1); the
            // appearance crossfades in from opacity 0 (uAppearanceMix 0 → 1).
            const [height, width] = frame.shape
            const tex = buildTexture(frame.dataU8, width, height)
            const colormapTex = buildOverlayColormapTexture(customStops)
            const initialAppearance = { ...appearance, opacity: 0 }
            const mat = new THREE.ShaderMaterial({
              vertexShader: overlayVertexShader,
              fragmentShader: overlayFragmentShader,
              uniforms: {
                uTexPrev:     { value: tex },
                uTexNext:     { value: tex },
                uCustomColormapPrev: { value: colormapTex },
                uCustomColormapNext: { value: colormapTex },
                uMix:         { value: 1.0 },
                uAppearanceMix: { value: 0.0 },
                uOpacityPrev: { value: initialAppearance.opacity },
                uOpacityNext: { value: appearance.opacity },
                uWorldSize:   { value: worldSize },
                uColormapPrev: { value: overlayColormapId(initialAppearance.colormap) },
                uColormapNext: { value: overlayColormapId(appearance.colormap) },
                uUseCustomColormapPrev: { value: initialAppearance.useCustomColormap },
                uUseCustomColormapNext: { value: appearance.useCustomColormap },
                uStretchLowPrev: { value: initialAppearance.stretchLow },
                uStretchHighPrev: { value: initialAppearance.stretchHigh },
                uStretchLowNext: { value: appearance.stretchLow },
                uStretchHighNext: { value: appearance.stretchHigh },
              },
              transparent: true,
              depthWrite: false,
              side: THREE.BackSide,
              glslVersion: THREE.GLSL3,
            })
            const mesh = new THREE.Mesh(slabGeo, mat)
            mesh.frustumCulled = false
            scene!.add(mesh)
            entry = {
              mesh,
              material: mat,
              prevTexture: tex,
              nextTexture: tex,
              frameMix: 1,
              frameBlendStart: -1,
              frameBlendDuration: 0,
              prevColormapTexture: colormapTex,
              nextColormapTexture: colormapTex,
              prevAppearance: initialAppearance,
              nextAppearance: appearance,
              appearanceMix: 0,
              appearanceBlendStart: performance.now(),
              appearanceBlendDuration: Math.max(0, opts.getBlendMs()),
              disposeAfterAppearanceBlend: appearance.opacity < 0.01,
              loadedFrameKey: frameKey,
              loadedAppearanceKey: appearanceKey,
            }
            entries.set(slug, entry)
            mapRef.triggerRepaint()
          } else {
            // Frame and appearance changes are handled on independent timelines —
            // neither restarts or snaps the other.
            if (entry.loadedFrameKey !== frameKey) {
              const [height, width] = frame.shape
              startFrameBlend(entry, buildTexture(frame.dataU8, width, height), frameKey)
              mapRef.triggerRepaint()
            }
            if (entry.loadedAppearanceKey !== appearanceKey) {
              startAppearanceBlend(entry, appearance, customStops, appearance.opacity < 0.01)
              mapRef.triggerRepaint()
            } else if (appearance.opacity >= 0.01) {
              // Visible and unchanged — cancel any pending fade-out disposal.
              entry.disposeAfterAppearanceBlend = false
            }
          }

          // Advance the data-frame crossfade.
          if (entry.frameBlendStart >= 0) {
            const elapsed = performance.now() - entry.frameBlendStart
            entry.frameMix = entry.frameBlendDuration <= 0 ? 1 : Math.min(elapsed / entry.frameBlendDuration, 1)
            if (entry.frameMix < 1) {
              mapRef.triggerRepaint()
            } else {
              entry.frameBlendStart = -1
            }
          }

          // Advance the appearance crossfade.
          if (entry.appearanceBlendStart >= 0) {
            const elapsed = performance.now() - entry.appearanceBlendStart
            entry.appearanceMix = entry.appearanceBlendDuration <= 0 ? 1 : Math.min(elapsed / entry.appearanceBlendDuration, 1)
            if (entry.appearanceMix < 1) {
              mapRef.triggerRepaint()
            } else {
              entry.appearanceBlendStart = -1
              if (entry.prevColormapTexture !== entry.nextColormapTexture) {
                entry.prevColormapTexture.dispose()
                entry.prevColormapTexture = entry.nextColormapTexture
              }
              entry.prevAppearance = entry.nextAppearance
            }
          }

          // Update per-frame uniforms
          applyEntryUniforms(entry)
          entry.material.uniforms.uWorldSize.value = worldSize

          // Flat slab: world-spanning, z=0
          entry.mesh.position.set(worldSize / 2, worldSize / 2, 0.1)
          entry.mesh.scale.set(worldSize, worldSize, 1)
        }
      }

      // Dispose meshes for slugs no longer active (or fully faded out)
      for (const [slug, entry] of entries) {
        const fadeOutComplete = entry.disposeAfterAppearanceBlend && entry.appearanceBlendStart < 0
        if (!activeSlugSet.has(slug) || fadeOutComplete) {
          disposeMeshEntry(entry)
          entries.delete(slug)
        }
      }

      if (entries.size === 0) return

      camera.projectionMatrix.fromArray(options.modelViewProjectionMatrix)

      renderer.resetState()
      renderer.render(scene, camera)
      renderer.resetState()
    },

    onRemove() {
      for (const entry of entries.values()) {
        disposeMeshEntry(entry)
      }
      entries.clear()
      slabGeo?.dispose()
      slabGeo = null
      renderer = null
      scene = null
      camera = null
      mapRef = null
    },
  }
}
