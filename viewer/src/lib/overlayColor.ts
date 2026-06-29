import * as THREE from 'three'
import type { OverlayColorStop, OverlayColormap } from '@/types'
import { OVERLAY_COLORMAPS } from '@/types'

export const OVERLAY_COLORMAP_LABELS: Record<OverlayColormap, string> = {
  viridis: 'Viridis',
  plasma: 'Plasma',
  thermal: 'Thermal',
  sequential: 'Seq.',
  custom: 'Custom',
}

export const OVERLAY_COLORMAP_GRADIENTS: Record<Exclude<OverlayColormap, 'custom'>, string> = {
  viridis: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)',
  plasma: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)',
  thermal: 'linear-gradient(to right, #0000ff, #00ffff, #ffff00, #ff0000)',
  sequential: 'linear-gradient(to right, #fafafa, #bad4ee, #2d7ab3, #17396b)',
}

function stopColorCss(stop: OverlayColorStop): string {
  const [r, g, b] = stop.color.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255))
  return `rgb(${r}, ${g}, ${b})`
}

export function overlayGradientCss(colormap: OverlayColormap, stops?: OverlayColorStop[]): string {
  if (colormap === 'custom' && stops?.length) {
    const parts = stops.map((stop) => `${stopColorCss(stop)} ${stop.position * 100}%`)
    return `linear-gradient(to right, ${parts.join(', ')})`
  }
  return OVERLAY_COLORMAP_GRADIENTS[colormap === 'custom' ? 'viridis' : colormap]
}

export function overlayColormapId(colormap: OverlayColormap): number {
  const idx = OVERLAY_COLORMAPS.indexOf(colormap)
  return idx >= 0 && colormap !== 'custom' ? idx : 0
}

export function overlayStopsSignature(stops?: OverlayColorStop[]): string {
  if (!stops?.length) return ''
  return stops
    .map((stop) => `${stop.position}:${stop.color.map((channel) => channel.toFixed(4)).join(',')}`)
    .join('|')
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function sampleStops(stops: OverlayColorStop[], t: number): [number, number, number] {
  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1]!
    const next = stops[i]!
    if (t <= next.position) {
      const span = Math.max(0.000001, next.position - prev.position)
      const localT = Math.max(0, Math.min(1, (t - prev.position) / span))
      return [
        lerp(prev.color[0], next.color[0], localT),
        lerp(prev.color[1], next.color[1], localT),
        lerp(prev.color[2], next.color[2], localT),
      ]
    }
  }
  return stops[stops.length - 1]?.color ?? [1, 1, 1]
}

export function buildOverlayColormapTexture(stops?: OverlayColorStop[]): THREE.DataTexture {
  const effectiveStops = stops?.length
    ? stops
    : [
        { position: 0, color: [0, 0, 0] as [number, number, number] },
        { position: 1, color: [1, 1, 1] as [number, number, number] },
      ]
  const width = 256
  const data = new Uint8Array(width * 4)
  for (let i = 0; i < width; i += 1) {
    const t = i / (width - 1)
    const [r, g, b] = sampleStops(effectiveStops, t)
    data[i * 4 + 0] = Math.round(Math.max(0, Math.min(1, r)) * 255)
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}
