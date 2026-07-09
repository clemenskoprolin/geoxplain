import {
  ALL_ATTRIBUTION_PRESET_COLORMAPS,
  ATTRIBUTION_NORMALIZATION_MODES,
  OVERLAY_COLORMAPS,
} from '@/types'
import type {
  AttributionNormalizationMode,
  AttributionPresetColormap,
  OverlayColormap,
  OverlayLayerState,
  ViewerGlobeCameraState,
  ViewerLaunchPressureLevelState,
  ViewerLaunchState,
  ViewerMapCameraState,
} from '@/types'

const STATE_QUERY_PARAM = 'state'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseGlobeCamera(value: unknown): ViewerGlobeCameraState | null {
  if (!isRecord(value)) return null
  const { lat, lng, altitude } = value
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || !isFiniteNumber(altitude)) return null
  return { lat, lng, altitude }
}

function parseMapCamera(value: unknown): ViewerMapCameraState | null {
  if (!isRecord(value)) return null
  const { lng, lat, zoom, pitch } = value
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat) || !isFiniteNumber(zoom) || !isFiniteNumber(pitch)) return null
  return { lng, lat, zoom, pitch }
}

function parsePressureLevels(value: unknown): ViewerLaunchPressureLevelState[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.map((entry) => {
    if (!isRecord(entry)) return null
    const { id, visible, opacity } = entry
    if (typeof id !== 'string' || typeof visible !== 'boolean' || !isFiniteNumber(opacity)) return null
    return { id, visible, opacity }
  })
  return parsed.every((entry) => entry !== null) ? parsed : null
}

function parseOverlayLayerStates(value: unknown): OverlayLayerState[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed = value.map((entry) => {
    if (!isRecord(entry)) return null
    const { slug, visible, opacity, colormap, stretchLow, stretchHigh } = entry
    if (typeof slug !== 'string') return null
    if (typeof visible !== 'boolean') return null
    if (!isFiniteNumber(opacity)) return null
    if (typeof colormap !== 'string' || !OVERLAY_COLORMAPS.includes(colormap as OverlayColormap)) return null
    if (!isFiniteNumber(stretchLow) || !isFiniteNumber(stretchHigh)) return null
    return { slug, visible, opacity, colormap: colormap as OverlayColormap, stretchLow, stretchHigh }
  })
  return parsed.every((entry) => entry !== null) ? (parsed as OverlayLayerState[]) : undefined
}

function parseAttributionColorSchemes(value: unknown): Record<string, AttributionPresetColormap> | undefined {
  if (!isRecord(value)) return undefined

  const parsed: Record<string, AttributionPresetColormap> = {}
  for (const [slug, scheme] of Object.entries(value)) {
    if (
      typeof scheme === 'string' &&
      ALL_ATTRIBUTION_PRESET_COLORMAPS.includes(scheme as AttributionPresetColormap)
    ) {
      parsed[slug] = scheme as AttributionPresetColormap
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined
}

function parseLaunchState(value: unknown): ViewerLaunchState | null {
  if (!isRecord(value)) return null

  const {
    selectedMethod,
    timestampIndex,
    viewMode,
    mapType,
    theme,
    contours,
    absolute,
    normalization,
    attributionColorSchemes,
    overlayLayerStates,
    pressureLevels,
    smoothImportedGrids,
    smoothImportedGridSigma,
    globeCamera,
    mapCamera,
  } = value

  if (typeof selectedMethod !== 'string') return null
  if (!isFiniteNumber(timestampIndex)) return null
  if (viewMode !== 'globe' && viewMode !== 'map') return null
  if (mapType !== 'satellite' && mapType !== 'topo') return null
  if (typeof smoothImportedGrids !== 'boolean') return null
  if (!isFiniteNumber(smoothImportedGridSigma)) return null

  const parsedPressureLevels = parsePressureLevels(pressureLevels)
  const parsedGlobeCamera = parseGlobeCamera(globeCamera)
  const parsedMapCamera = parseMapCamera(mapCamera)
  if (!parsedPressureLevels || !parsedGlobeCamera || !parsedMapCamera) return null

  return {
    selectedMethod,
    timestampIndex,
    viewMode,
    mapType,
    theme: theme === 'dark' || theme === 'light' ? theme : undefined,
    contours: typeof contours === 'boolean' ? contours : undefined,
    absolute: typeof absolute === 'boolean' ? absolute : undefined,
    normalization:
      typeof normalization === 'string'
      && ATTRIBUTION_NORMALIZATION_MODES.includes(normalization as AttributionNormalizationMode)
        ? normalization as AttributionNormalizationMode
        : undefined,
    attributionColorSchemes: parseAttributionColorSchemes(attributionColorSchemes),
    overlayLayerStates: parseOverlayLayerStates(overlayLayerStates),
    pressureLevels: parsedPressureLevels,
    smoothImportedGrids,
    smoothImportedGridSigma,
    globeCamera: parsedGlobeCamera,
    mapCamera: parsedMapCamera,
  }
}

export function buildBrowserLaunchUrl(href: string, state: ViewerLaunchState): string {
  const url = new URL(href, window.location.href)
  url.searchParams.set(STATE_QUERY_PARAM, JSON.stringify(state))
  return url.toString()
}

export function parseLaunchStateFromSearch(search: string): ViewerLaunchState | undefined {
  const encoded = new URLSearchParams(search).get(STATE_QUERY_PARAM)
  if (!encoded) return undefined

  try {
    return parseLaunchState(JSON.parse(encoded)) ?? undefined
  } catch {
    return undefined
  }
}
