/**
 * WebGL1 fallback diverging ramp approximating matplotlib's RdBu_r.
 * Only used as WebGL1 fallback (the WebGL2 path uses the volume renderer).
 */
export function heatmapColor(t: number, opacity: number, visibleCount: number): string {
  const anchors = [
    [5, 48, 97],
    [33, 102, 172],
    [67, 147, 195],
    [146, 197, 222],
    [209, 229, 240],
    [247, 247, 247],
    [253, 219, 199],
    [244, 165, 130],
    [214, 96, 77],
    [178, 24, 43],
    [103, 0, 31],
  ] as const

  const scaled = Math.max(0, Math.min(0.9999, t)) * (anchors.length - 1)
  const idx = Math.floor(scaled)
  const frac = scaled - idx
  const from = anchors[idx]
  const to = anchors[Math.min(idx + 1, anchors.length - 1)]
  const r = Math.round(from[0] + (to[0] - from[0]) * frac)
  const g = Math.round(from[1] + (to[1] - from[1]) * frac)
  const b = Math.round(from[2] + (to[2] - from[2]) * frac)

  const dist = Math.abs(t - 0.5) * 2
  const layerScale = Math.min(1, 1.2 / visibleCount)
  const intensityFade = Math.pow(dist, 1.35)
  const a = opacity * layerScale * intensityFade
  return `rgba(${r},${g},${b},${a})`
}
