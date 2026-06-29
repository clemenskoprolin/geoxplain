import * as THREE from 'three'
import type { OverlayColorStop, OverlayColormap, OverlayData, OverlayLayerState } from '@/types'
import { overlayColormapId, overlayStopsSignature } from '@/lib/overlayColor'

export interface GlobeOverlayEntry {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  geometry: THREE.SphereGeometry
  // Data-frame crossfade (uMix) — independent timeline.
  prevTexture: THREE.DataTexture
  nextTexture: THREE.DataTexture
  frameMix: number
  frameRaf: number
  // Appearance crossfade (uAppearanceMix) — independent timeline.
  prevColormapTexture: THREE.DataTexture
  nextColormapTexture: THREE.DataTexture
  prevAppearance: GlobeOverlayAppearance
  nextAppearance: GlobeOverlayAppearance
  appearanceMix: number
  appearanceRaf: number
  disposeAfterAppearanceBlend: boolean
  loadedFrameKey: string
  loadedAppearanceKey: string
}

export interface GlobeOverlayAppearance {
  opacity: number
  colormap: OverlayColormap
  useCustomColormap: boolean
  stretchLow: number
  stretchHigh: number
  colormapKey: string
}

export function buildOverlayTexture(dataU8: Uint8Array, width: number, height: number): THREE.DataTexture {
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

export function globeOverlayAppearanceKey(appearance: GlobeOverlayAppearance): string {
  return [
    appearance.opacity.toFixed(4),
    appearance.colormap,
    appearance.useCustomColormap ? 'custom' : 'preset',
    appearance.colormapKey,
    appearance.stretchLow.toFixed(4),
    appearance.stretchHigh.toFixed(4),
  ].join(':')
}

export function globeOverlayAppearance(
  overlayData: OverlayData,
  state: OverlayLayerState | undefined,
  opacity: number,
): { appearance: GlobeOverlayAppearance; customStops?: OverlayColorStop[] } {
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

export function applyGlobeOverlayAppearanceUniforms(
  material: THREE.ShaderMaterial,
  suffix: 'Prev' | 'Next',
  appearance: GlobeOverlayAppearance,
) {
  material.uniforms[`uOpacity${suffix}`].value = appearance.opacity
  material.uniforms[`uColormap${suffix}`].value = overlayColormapId(appearance.colormap)
  material.uniforms[`uUseCustomColormap${suffix}`].value = appearance.useCustomColormap
  material.uniforms[`uStretchLow${suffix}`].value = appearance.stretchLow
  material.uniforms[`uStretchHigh${suffix}`].value = appearance.stretchHigh
}

/** Push the entry's full prev/next state (both crossfades) to the material. */
export function applyGlobeOverlayEntryUniforms(entry: GlobeOverlayEntry) {
  entry.material.uniforms.uTexPrev.value = entry.prevTexture
  entry.material.uniforms.uTexNext.value = entry.nextTexture
  entry.material.uniforms.uMix.value = entry.frameMix
  entry.material.uniforms.uCustomColormapPrev.value = entry.prevColormapTexture
  entry.material.uniforms.uCustomColormapNext.value = entry.nextColormapTexture
  entry.material.uniforms.uAppearanceMix.value = entry.appearanceMix
  applyGlobeOverlayAppearanceUniforms(entry.material, 'Prev', entry.prevAppearance)
  applyGlobeOverlayAppearanceUniforms(entry.material, 'Next', entry.nextAppearance)
}

export function disposeOverlayEntry(entry: GlobeOverlayEntry) {
  if (entry.frameRaf) {
    cancelAnimationFrame(entry.frameRaf)
    entry.frameRaf = 0
  }
  if (entry.appearanceRaf) {
    cancelAnimationFrame(entry.appearanceRaf)
    entry.appearanceRaf = 0
  }
  const textures = new Set([
    entry.prevTexture,
    entry.nextTexture,
    entry.prevColormapTexture,
    entry.nextColormapTexture,
  ])
  textures.forEach((texture) => texture.dispose())
  entry.material.dispose()
  entry.geometry.dispose()
}
