import { DEFAULT_ALTITUDE } from '@/components/Globe'
import { DEFAULT_MAP_ZOOM } from '@/components/MapView'
import type {
  DenseGridInput,
  DenseLevelGrid,
  PressureLevel,
  ViewerLaunchState,
} from '@/types'

/** Parse a label like ``"saliency (t)"`` → ``{ base: "saliency", inputVar: "t" }``. */
export function parseInputVarLabel(label: string): { base: string; inputVar: string } | null {
  const match = label.match(/^(.+?)\s+\(([^)]+)\)$/)
  if (!match) return null
  return { base: match[1], inputVar: match[2] }
}

export function globeAltitudeToMapZoom(alt: number) {
  return DEFAULT_MAP_ZOOM + Math.log2(DEFAULT_ALTITUDE / alt)
}

export function mapZoomToGlobeAltitude(zoom: number) {
  return DEFAULT_ALTITUDE / Math.pow(2, zoom - DEFAULT_MAP_ZOOM)
}

function hashUint8(bytes: Uint8Array): string {
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function externalGridSignature(levels: Record<string, DenseLevelGrid> | null): string {
  if (!levels) return 'none'
  return Object.entries(levels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([levelId, level]) => `${levelId}:${level.shape[0]}x${level.shape[1]}:${hashUint8(level.dataU8)}`)
    .join('|')
}

/**
 * Scan attribution data to find the lat/lon bounding box of significant values.
 */
export function computeDataBounds(
  data: DenseGridInput,
): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
  const methodEntries = Object.values(data.methods)
  if (!methodEntries.length) return null
  const frame = methodEntries[0].frames[0]
  if (!frame) return null
  const levelEntries = Object.values(frame.levels)
  if (!levelEntries.length) return null

  const diverging = frame.diverging ?? data.diverging
  const threshold = diverging ? Math.round(127 * 0.2) : Math.round(255 * 0.2)

  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity
  let found = false

  for (const level of levelEntries) {
    const [H, W] = level.shape
    if (H < 2 || W < 2) continue
    const { dataU8 } = level

    let minRow = H, maxRow = -1, minCol = W, maxCol = -1
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const val = dataU8[r * W + c]
        const sig = diverging ? Math.abs(val - 128) > threshold : val > threshold
        if (sig) {
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
        }
      }
    }
    if (maxRow === -1) continue

    found = true
    latMax = Math.max(latMax, 90 - (minRow / (H - 1)) * 180)
    latMin = Math.min(latMin, 90 - (maxRow / (H - 1)) * 180)
    lonMin = Math.min(lonMin, -180 + (minCol / (W - 1)) * 360)
    lonMax = Math.max(lonMax, -180 + (maxCol / (W - 1)) * 360)
  }

  if (!found) return null

  return { latMin, latMax, lonMin, lonMax }
}

export function applyLaunchPressureLevels(
  defaults: PressureLevel[],
  overrides?: ViewerLaunchState['pressureLevels'],
): PressureLevel[] {
  if (!overrides?.length) return defaults
  const byId = new Map(overrides.map((level) => [level.id, level]))
  return defaults.map((level) => {
    const override = byId.get(level.id)
    if (!override) return level
    return {
      ...level,
      visible: override.visible,
      opacity: Math.max(0, Math.min(1, override.opacity)),
    }
  })
}
