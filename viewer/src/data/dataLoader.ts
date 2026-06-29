import { normalizeTarget, normalizeTargetColor } from '@/lib/targets'
import type { AttributionColorScheme, AttributionPresetColormap, DenseGridInput, DenseLevelGrid, DenseMethodData, DenseMethodFrame, OverlayColorStop, OverlayColormap, OverlayData, OverlayFrame, ViewerInitialOptions, ViewerTarget } from '@/types'
import { ALL_ATTRIBUTION_PRESET_COLORMAPS, DEFAULT_APP_SUBTITLE, DEFAULT_APP_TITLE, OVERLAY_COLORMAPS } from '@/types'

interface RawLevel {
  z: number
  label: string
  shape: [number, number]
  data_u8_b64: string
}

interface RawMethod {
  label: string
  shortLabel?: string
  timestamp?: string
  diverging?: boolean
  colorScheme?: RawColorScheme
  target?: RawTarget
  levels?: Record<string, RawLevel>
  frames?: Array<{
    timestamp?: string
    diverging?: boolean
    target?: RawTarget
    levels: Record<string, RawLevel>
  }>
}

type RawColorScheme =
  | { type?: string; name?: string; stops?: Array<{ position?: number; color?: string }> }
  | string

interface RawTargetPoint {
  type: 'point'
  lat: number
  lon: number
}

interface RawTargetBox {
  type: 'box'
  latMin: number
  lonMin: number
  latMax: number
  lonMax: number
}

type RawTarget = RawTargetPoint | RawTargetBox

interface RawOverlayFrame {
  timestamp?: string
  shape: [number, number]
  data_u8_b64: string
}

interface RawOverlay {
  label: string
  unit?: string
  colormap?: string
  colormapStops?: Array<[number, string]>
  visible?: boolean
  opacity?: number
  stretchLow?: number
  stretchHigh?: number
  timeOffsetHours?: number
  timeLabel?: string
  minVal?: number
  maxVal?: number
  frames: RawOverlayFrame[]
}

interface RawViewerData {
  version: number
  diverging: boolean
  appTitle?: string
  appSubtitle?: string
  contours?: boolean
  absolute?: boolean
  viewerOptions?: RawViewerOptions
  targetColor?: string
  contentHash?: string
  methods: Record<string, RawMethod>
  overlays?: Record<string, RawOverlay>
}

interface RawViewerOptions {
  viewMode?: unknown
  mapType?: unknown
  smoothImportedGrids?: unknown
  smoothImportedGridSigma?: unknown
  zoomOutFactor?: unknown
}

export interface ViewerDataSnapshot {
  contentHash: string | null
  data: DenseGridInput | null
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binaryStr = atob(b64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

function decodeLevels(rawLevels: Record<string, RawLevel>): Record<string, DenseLevelGrid> {
  const levels: Record<string, DenseLevelGrid> = {}
  for (const [levelId, rawLevel] of Object.entries(rawLevels)) {
    const dataU8 = base64ToUint8Array(rawLevel.data_u8_b64)
    const [height, width] = rawLevel.shape
    if (dataU8.length !== height * width) {
      throw new Error(`Dense grid ${levelId} has shape ${height}x${width} but ${dataU8.length} bytes`)
    }
    levels[levelId] = {
      z: rawLevel.z,
      label: rawLevel.label ?? levelId,
      shape: rawLevel.shape,
      dataU8,
    }
  }
  return levels
}

function decodeTarget(rawTarget: RawTarget | undefined): ViewerTarget | null {
  if (!rawTarget || typeof rawTarget !== 'object' || !('type' in rawTarget)) return null
  if (
    rawTarget.type === 'point'
    && typeof rawTarget.lat === 'number'
    && typeof rawTarget.lon === 'number'
  ) {
    return normalizeTarget({
      type: 'point',
      lat: rawTarget.lat,
      lon: rawTarget.lon,
    })
  }
  if (
    rawTarget.type === 'box'
    && typeof rawTarget.latMin === 'number'
    && typeof rawTarget.lonMin === 'number'
    && typeof rawTarget.latMax === 'number'
    && typeof rawTarget.lonMax === 'number'
  ) {
    return normalizeTarget({
      type: 'box',
      latMin: rawTarget.latMin,
      lonMin: rawTarget.lonMin,
      latMax: rawTarget.latMax,
      lonMax: rawTarget.lonMax,
    })
  }
  return null
}

function parseHexColor(color: unknown): [number, number, number] | null {
  if (typeof color !== 'string') return null
  const match = color.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!match) return null
  const hex = match[1].length === 3
    ? match[1].split('').map((ch) => ch + ch).join('')
    : match[1]
  const intValue = Number.parseInt(hex, 16)
  return [
    ((intValue >> 16) & 255) / 255,
    ((intValue >> 8) & 255) / 255,
    (intValue & 255) / 255,
  ]
}

function decodeAttributionColorScheme(rawScheme: RawColorScheme | undefined): AttributionColorScheme {
  if (typeof rawScheme === 'string') {
    const name = rawScheme.trim().toLowerCase().replaceAll('_', '-')
    return ALL_ATTRIBUTION_PRESET_COLORMAPS.includes(name as never)
      ? { type: 'preset', name: name as AttributionPresetColormap }
      : { type: 'preset', name: 'default' }
  }

  if (!rawScheme || typeof rawScheme !== 'object') {
    return { type: 'preset', name: 'default' }
  }

  if (rawScheme.type === 'preset') {
    const name = typeof rawScheme.name === 'string'
      ? rawScheme.name.trim().toLowerCase().replaceAll('_', '-')
      : 'default'
    return ALL_ATTRIBUTION_PRESET_COLORMAPS.includes(name as never)
      ? { type: 'preset', name: name as AttributionPresetColormap }
      : { type: 'preset', name: 'default' }
  }

  if (rawScheme.type === 'custom' && Array.isArray(rawScheme.stops)) {
    const stops = rawScheme.stops.map((stop) => {
      const color = parseHexColor(stop.color)
      return typeof stop.position === 'number' && color
        ? { position: stop.position, color }
        : null
    })
    if (
      stops.length >= 2 &&
      stops.length <= 8 &&
      stops.every((stop): stop is NonNullable<typeof stop> => !!stop) &&
      stops.every((stop, index) => (
        stop.position >= 0 &&
        stop.position <= 1 &&
        (index === 0 || stop.position > stops[index - 1]!.position)
      ))
    ) {
      return { type: 'custom', stops }
    }
  }

  return { type: 'preset', name: 'default' }
}

function decodeOverlayColorStops(rawStops: RawOverlay['colormapStops']): OverlayColorStop[] | undefined {
  if (!Array.isArray(rawStops)) return undefined
  const stops = rawStops.map((stop) => {
    if (!Array.isArray(stop) || stop.length !== 2) return null
    const [position, colorValue] = stop
    const color = parseHexColor(colorValue)
    return typeof position === 'number' && color ? { position, color } : null
  })
  if (
    stops.length >= 2 &&
    stops.every((stop): stop is NonNullable<typeof stop> => !!stop) &&
    stops[0]!.position === 0 &&
    stops[stops.length - 1]!.position === 1 &&
    stops.every((stop, index) => (
      stop.position >= 0 &&
      stop.position <= 1 &&
      (index === 0 || stop.position > stops[index - 1]!.position)
    ))
  ) {
    return stops
  }
  return undefined
}

function decodeOverlays(rawOverlays: Record<string, RawOverlay>): Record<string, OverlayData> {
  const overlays: Record<string, OverlayData> = {}
  for (const [slug, rawOverlay] of Object.entries(rawOverlays)) {
    const frames: OverlayFrame[] = (rawOverlay.frames ?? []).map((rawFrame) => {
      const dataU8 = base64ToUint8Array(rawFrame.data_u8_b64)
      const [height, width] = rawFrame.shape
      if (dataU8.length !== height * width) {
        throw new Error(`Overlay ${slug} frame has shape ${height}x${width} but ${dataU8.length} bytes`)
      }
      const frame: OverlayFrame = { shape: rawFrame.shape, dataU8 }
      if (rawFrame.timestamp) frame.timestamp = rawFrame.timestamp
      return frame
    })
    if (frames.length === 0) continue

    const colormapStops = decodeOverlayColorStops(rawOverlay.colormapStops)
    const rawColormap = rawOverlay.colormap
    const colormap = (
      rawColormap === 'custom' && colormapStops
        ? 'custom'
        : OVERLAY_COLORMAPS.includes(rawColormap as OverlayColormap) && rawColormap !== 'custom'
          ? rawColormap
          : 'viridis'
    ) as OverlayColormap

    overlays[slug] = {
      label: rawOverlay.label ?? slug,
      unit: rawOverlay.unit ?? '',
      colormap,
      ...(colormapStops ? { colormapStops } : {}),
      visible: rawOverlay.visible ?? true,
      ...(typeof rawOverlay.opacity === 'number' ? { opacity: rawOverlay.opacity } : {}),
      ...(typeof rawOverlay.stretchLow === 'number' ? { stretchLow: rawOverlay.stretchLow } : {}),
      ...(typeof rawOverlay.stretchHigh === 'number' ? { stretchHigh: rawOverlay.stretchHigh } : {}),
      ...(typeof rawOverlay.timeOffsetHours === 'number' ? { timeOffsetHours: rawOverlay.timeOffsetHours } : {}),
      ...(typeof rawOverlay.timeLabel === 'string' && rawOverlay.timeLabel ? { timeLabel: rawOverlay.timeLabel } : {}),
      minVal: rawOverlay.minVal ?? 0,
      maxVal: rawOverlay.maxVal ?? 1,
      frames,
    }
  }
  return overlays
}

function decodeViewerOptions(rawOptions: RawViewerOptions | undefined): ViewerInitialOptions | undefined {
  if (!rawOptions || typeof rawOptions !== 'object') return undefined
  const options: ViewerInitialOptions = {}
  if (rawOptions.viewMode === 'map' || rawOptions.viewMode === 'globe') {
    options.viewMode = rawOptions.viewMode
  }
  if (rawOptions.mapType === 'topo' || rawOptions.mapType === 'satellite') {
    options.mapType = rawOptions.mapType
  }
  if (typeof rawOptions.smoothImportedGrids === 'boolean') {
    options.smoothImportedGrids = rawOptions.smoothImportedGrids
  }
  if (typeof rawOptions.smoothImportedGridSigma === 'number' && Number.isFinite(rawOptions.smoothImportedGridSigma)) {
    options.smoothImportedGridSigma = rawOptions.smoothImportedGridSigma
  }
  if (typeof rawOptions.zoomOutFactor === 'number' && Number.isFinite(rawOptions.zoomOutFactor) && rawOptions.zoomOutFactor > 0) {
    options.zoomOutFactor = rawOptions.zoomOutFactor
  }
  return Object.keys(options).length > 0 ? options : undefined
}

function decodeRawViewerData(raw: RawViewerData): DenseGridInput {
  const methods: Record<string, DenseMethodData> = {}
  for (const [slug, rawMethod] of Object.entries(raw.methods)) {
    let frames: DenseMethodFrame[]
    if (rawMethod.frames && rawMethod.frames.length > 0) {
      frames = rawMethod.frames.map((frame) => ({
        timestamp: frame.timestamp,
        diverging: frame.diverging ?? rawMethod.diverging ?? raw.diverging,
        target: decodeTarget(frame.target),
        levels: decodeLevels(frame.levels),
      }))
    } else {
      frames = [{
        timestamp: rawMethod.timestamp,
        diverging: rawMethod.diverging ?? raw.diverging,
        target: decodeTarget(rawMethod.target),
        levels: decodeLevels(rawMethod.levels ?? {}),
      }]
    }
    methods[slug] = {
      label: rawMethod.label,
      shortLabel: rawMethod.shortLabel ?? rawMethod.label.slice(0, 3).toUpperCase(),
      diverging: rawMethod.diverging ?? raw.diverging,
      colorScheme: decodeAttributionColorScheme(rawMethod.colorScheme),
      frames,
    }
  }
  const result: DenseGridInput = {
    version: raw.version,
    diverging: raw.diverging,
    appTitle: typeof raw.appTitle === 'string' && raw.appTitle.trim()
      ? raw.appTitle.trim()
      : DEFAULT_APP_TITLE,
    appSubtitle: typeof raw.appSubtitle === 'string'
      ? raw.appSubtitle.trim()
      : DEFAULT_APP_SUBTITLE,
    targetColor: normalizeTargetColor(raw.targetColor),
    methods,
  }

  if (typeof raw.contours === 'boolean') {
    result.contours = raw.contours
  }

  if (typeof raw.absolute === 'boolean') {
    result.absolute = raw.absolute
  }

  const viewerOptions = decodeViewerOptions(raw.viewerOptions)
  if (viewerOptions) {
    result.viewerOptions = viewerOptions
  }

  if (raw.overlays && typeof raw.overlays === 'object' && !Array.isArray(raw.overlays)) {
    const overlays = decodeOverlays(raw.overlays)
    if (Object.keys(overlays).length > 0) {
      result.overlays = overlays
    }
  }

  return result
}

function parseRawViewerData(raw: unknown): ViewerDataSnapshot | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    const typed = raw as RawViewerData
    if (!typed.methods || typeof typed.methods !== 'object' || Array.isArray(typed.methods)) return null
    const hasMethods = Object.keys(typed.methods).length > 0
    return {
      contentHash: typeof typed.contentHash === 'string' && typed.contentHash
        ? typed.contentHash
        : JSON.stringify(typed),
      data: hasMethods ? decodeRawViewerData(typed) : null,
    }
  } catch {
    return null
  }
}

/**
 * Fetch and parse viewer_data.json (v4 dense-grid format).
 * Returns null gracefully on 404, parse error, or empty payload.
 */
export async function fetchViewerData(url: string): Promise<DenseGridInput | null> {
  const snapshot = await fetchViewerDataSnapshot(url)
  return snapshot?.data ?? null
}

export async function fetchViewerDataSnapshot(url: string): Promise<ViewerDataSnapshot | null> {
  try {
    const requestUrl = new URL(url, window.location.href)
    requestUrl.searchParams.set('_', `${Date.now()}`)
    const response = await fetch(requestUrl, { cache: 'no-store' })
    if (!response.ok) return null
    return parseRawViewerData(await response.json())
  } catch {
    return null
  }
}

/**
 * Parse a grids_payload dict (already deserialized from JSON, as received from
 * the anywidget Python trait) into a DenseGridInput.
 *
 * Returns null if the payload is empty or malformed.
 */
export function parseViewerPayload(payload: unknown): DenseGridInput | null {
  return parseRawViewerData(payload)?.data ?? null
}
