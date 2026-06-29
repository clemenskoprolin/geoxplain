import type { TargetBox, ViewerTarget } from '@/types'

export const DEFAULT_TARGET_COLOR = '#06b6d4'

function clampLatitude(lat: number): number {
  return Math.max(-90, Math.min(90, lat))
}

export function normalizeLongitude(lon: number): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180
  return Object.is(wrapped, -0) ? 0 : wrapped
}

export function normalizeTarget(target: ViewerTarget): ViewerTarget {
  if (target.type === 'point') {
    return {
      type: 'point',
      lat: clampLatitude(target.lat),
      lon: normalizeLongitude(target.lon),
    }
  }

  return {
    type: 'box',
    latMin: clampLatitude(Math.min(target.latMin, target.latMax)),
    lonMin: normalizeLongitude(target.lonMin),
    latMax: clampLatitude(Math.max(target.latMin, target.latMax)),
    lonMax: normalizeLongitude(target.lonMax),
  }
}

export function normalizeTargetColor(targetColor: unknown): string {
  return typeof targetColor === 'string' && targetColor.trim()
    ? targetColor.trim()
    : DEFAULT_TARGET_COLOR
}

export function targetSignature(target: ViewerTarget | null | undefined): string {
  if (!target) return 'none'
  return JSON.stringify(normalizeTarget(target))
}

export function splitWrappedTargetBox(box: TargetBox): TargetBox[] {
  const normalized = normalizeTarget(box)
  if (normalized.type !== 'box') return []
  if (normalized.lonMin <= normalized.lonMax) {
    return [normalized]
  }
  // Wrapped across the antimeridian: split into an eastern [lonMin, 180] and a
  // western [-180, lonMax] segment.  Drop a degenerate zero-width segment that
  // arises when an edge lands exactly on ±180 (e.g. lonMax === -180), which
  // would otherwise render as a stray hairline at the seam.
  return [
    { ...normalized, lonMax: 180 },
    { ...normalized, lonMin: -180 },
  ].filter(seg => seg.lonMin < seg.lonMax)
}
