export type XAIMethod =
  | 'integrated-gradients'
  | 'grad-cam'
  | 'rise'
  | 'lime'
  | 'shap'
  | 'attention'

export type ViewerMode = 'globe' | 'map'

export type GlobeMapType = 'satellite' | 'topo'

export const DEFAULT_APP_TITLE = 'GeoXplain'
export const DEFAULT_APP_SUBTITLE = 'Interactive geospatial attribution viewer'

export interface PressureLevel {
  id: string          // layer key, e.g. "z-2" or "sfc"
  label: string       // display name, e.g. "850 hPa" or the bare number
  z: number           // vertical order; higher renders higher ("sfc" lowest)
  visible: boolean
  opacity: number
  // Globe rendering altitudes (globe-radius units), derived from z order
  baseAltitude: number
  topAltitude: number
}

export interface AttributionPoint {
  id: string
  x: number   // longitude
  y: number   // latitude
  intensity: number // 0-1 normalized
  pressureLevelId: string
}

export interface TimestampData {
  timestamp: Date
  label: string
  methods: {
    [key in XAIMethod]?: AttributionPoint[]
  }
}

export const XAI_METHODS: { id: XAIMethod; label: string; shortLabel: string; description: string }[] = [
  { id: 'integrated-gradients', label: 'Integrated Gradients', shortLabel: 'IG', description: 'Path-based attribution integrating gradients along a straight line from baseline to input' },
  { id: 'grad-cam', label: 'Grad-CAM', shortLabel: 'GC', description: 'Gradient-weighted class activation mapping using feature map gradients' },
  { id: 'rise', label: 'RISE', shortLabel: 'RS', description: 'Randomized input sampling for explanation of black-box models' },
  { id: 'lime', label: 'LIME', shortLabel: 'LM', description: 'Local interpretable model-agnostic explanations via surrogate models' },
  { id: 'shap', label: 'SHAP', shortLabel: 'SH', description: 'Shapley additive explanations based on cooperative game theory' },
  { id: 'attention', label: 'Attention', shortLabel: 'AT', description: 'Transformer attention weight visualization across spatial patches' },
]

export interface DenseLevelGrid {
  z: number                 // vertical order; higher renders higher ("sfc" lowest)
  label: string             // display name for this layer
  shape: [number, number]   // [H, W] — native imported grid after longitude roll
  dataU8: Uint8Array        // H×W flat, row-major (lat × lon)
}

export interface TargetPoint {
  type: 'point'
  lat: number
  lon: number
}

export interface TargetBox {
  type: 'box'
  latMin: number
  lonMin: number
  latMax: number
  lonMax: number
}

export type ViewerTarget = TargetPoint | TargetBox

export interface DenseMethodFrame {
  timestamp?: string
  diverging?: boolean
  target?: ViewerTarget | null
  levels: Record<string, DenseLevelGrid>  // keyed by pressureLevelId e.g. "pl-700"
}

export type AttributionPresetColormap =
  | 'default'
  | 'rdbu'
  | 'coolwarm'
  | 'purple-green'
  | 'reds'
  | 'viridis'
  | 'plasma'
  | 'magma'
  | 'inferno'
  | 'cividis'
  | 'contour-default'
  | 'contour-amber'
  | 'contour-teal'
  | 'contour-blue-red'
  | 'contour-green-magenta'
  | 'contour-custom'

/** All presets supported by the renderer and saved launch state. */
export const ALL_ATTRIBUTION_PRESET_COLORMAPS: AttributionPresetColormap[] = [
  'default',
  'rdbu',
  'coolwarm',
  'purple-green',
  'reds',
  'viridis',
  'plasma',
  'magma',
  'inferno',
  'cividis',
  'contour-default',
  'contour-amber',
  'contour-teal',
  'contour-blue-red',
  'contour-green-magenta',
]

/** Palettes shown in the UI (default covers RdBu / Reds; no duplicate swatches). */
export const ATTRIBUTION_PRESET_COLORMAPS: AttributionPresetColormap[] = [
  'default',
  'coolwarm',
  'purple-green',
  'viridis',
  'plasma',
  'magma',
  'inferno',
  'cividis',
]

export interface AttributionColorStop {
  position: number
  color: [number, number, number]
}

export type AttributionColorScheme =
  | { type: 'preset'; name: AttributionPresetColormap }
  | { type: 'custom'; stops: AttributionColorStop[] }

export interface DenseMethodData {
  label: string             // human-readable: "Contrastive Saliency"
  shortLabel: string        // abbreviation: "CS"
  diverging?: boolean
  colorScheme: AttributionColorScheme
  frames: DenseMethodFrame[]
}

export type OverlayColormap = 'viridis' | 'plasma' | 'thermal' | 'sequential' | 'custom'

export const OVERLAY_COLORMAPS: OverlayColormap[] = ['viridis', 'plasma', 'thermal', 'sequential', 'custom']

export interface OverlayColorStop {
  position: number
  color: [number, number, number]
}

export interface OverlayFrame {
  timestamp?: string
  shape: [number, number]   // [H, W]
  dataU8: Uint8Array        // H×W flat, row-major; 0=minVal, 255=maxVal
}

export interface OverlayData {
  label: string
  unit: string
  colormap: OverlayColormap
  colormapStops?: OverlayColorStop[]
  visible?: boolean  // default initial visibility; undefined treated as true
  /** Python-side default layer opacity in [0, 1]; undefined falls back to 0.7. */
  opacity?: number
  /** Python-side default contrast-stretch low edge, fraction of range [0, 1]; undefined → 0. */
  stretchLow?: number
  /** Python-side default contrast-stretch high edge, fraction of range [0, 1]; undefined → 1. */
  stretchHigh?: number
  /** Hours the field is shifted relative to the displayed frame (negative = earlier, positive = later); undefined → no annotation. */
  timeOffsetHours?: number
  /** Free-text annotation shown next to the offset, e.g. "Aurora input step t0" or "Forecast valid time t2"; undefined → omitted. */
  timeLabel?: string
  minVal: number
  maxVal: number
  frames: OverlayFrame[]
}

export interface OverlayLayerState {
  slug: string
  visible: boolean
  opacity: number
  colormap: OverlayColormap
  stretchLow: number   // fraction of encoded range [0, 1], default 0
  stretchHigh: number  // fraction of encoded range [0, 1], default 1
}

export interface ViewerInitialOptions {
  viewMode?: ViewerMode
  mapType?: GlobeMapType
  smoothImportedGrids?: boolean
  smoothImportedGridSigma?: number
  /** Multiplier applied to the auto-fit camera distance (>1 zooms out, e.g. 1.6 = 160%). */
  zoomOutFactor?: number
}

export interface DenseGridInput {
  version: number
  diverging: boolean
  /** Optional application title shown in the viewer header */
  appTitle?: string
  /** Optional application subtitle shown below the title. Empty string hides it. */
  appSubtitle?: string
  /** Optional Python-side default: render attribution as contour isolines */
  contours?: boolean
  /** Optional Python-side default: render absolute magnitude instead of signed values */
  absolute?: boolean
  /** Optional Python-side defaults for the initial viewer state */
  viewerOptions?: ViewerInitialOptions
  targetColor: string
  methods: Record<string, DenseMethodData>  // keyed by slug: "contrastive-saliency"
  overlays?: Record<string, OverlayData>    // keyed by slug: "specific-humidity-850hpa"
}

export interface ViewerLaunchPressureLevelState {
  id: string
  visible: boolean
  opacity: number
}

export interface ViewerGlobeCameraState {
  lat: number
  lng: number
  altitude: number
}

export interface ViewerMapCameraState {
  lng: number
  lat: number
  zoom: number
  pitch: number
}

export type ViewerThemeMode = 'dark' | 'light'

export interface ViewerLaunchState {
  selectedMethod: string
  timestampIndex: number
  viewMode: ViewerMode
  mapType: GlobeMapType
  /** UI theme; optional so launch URLs from older builds stay valid */
  theme?: ViewerThemeMode
  /** Contour-line depiction; optional so launch URLs from older builds stay valid */
  contours?: boolean
  /** Absolute-magnitude depiction; optional so launch URLs from older builds stay valid */
  absolute?: boolean
  /** Per-method preset palette overrides; optional so launch URLs from older builds stay valid */
  attributionColorSchemes?: Record<string, AttributionPresetColormap>
  /** Full overlay UI state (visibility, opacity, colormap, contrast stretch); optional so launch URLs from older builds stay valid */
  overlayLayerStates?: OverlayLayerState[]
  pressureLevels: ViewerLaunchPressureLevelState[]
  smoothImportedGrids: boolean
  smoothImportedGridSigma: number
  globeCamera: ViewerGlobeCameraState
  mapCamera: ViewerMapCameraState
}

// Vertical band (globe-radius units) over which layers are distributed.
export const LEVEL_BAND_MIN = 0.0
export const LEVEL_BAND_MAX = 0.058

// Demo-mode fallback only.  Real data drives the level table via
// buildLevelsFromData(); these are used when no externalData is present.
export const DEFAULT_PRESSURE_LEVELS: PressureLevel[] = [
  { id: 'z-0', label: '1000 hPa', z: 0, visible: true,  opacity: 1.0, baseAltitude: 0.000, topAltitude: 0.004 },
  { id: 'z-2', label: '850 hPa',  z: 2, visible: true,  opacity: 1.0, baseAltitude: 0.004, topAltitude: 0.010 },
  { id: 'z-3', label: '700 hPa',  z: 3, visible: true,  opacity: 1.0, baseAltitude: 0.010, topAltitude: 0.017 },
  { id: 'z-5', label: '500 hPa',  z: 5, visible: true,  opacity: 1.0, baseAltitude: 0.019, topAltitude: 0.030 },
  { id: 'z-7', label: '300 hPa',  z: 7, visible: true,  opacity: 1.0, baseAltitude: 0.033, topAltitude: 0.047 },
  { id: 'z-9', label: '200 hPa',  z: 9, visible: false, opacity: 1.0, baseAltitude: 0.049, topAltitude: 0.058 },
]

/**
 * Build the vertical level table from imported data.  Collects every distinct
 * layer across all methods/frames, orders them by `z` ascending ("sfc" lowest),
 * and distributes them evenly across the globe's vertical band.  Higher `z`
 * therefore renders higher.  Labels come straight from the data.
 */
export function buildLevelsFromData(data: DenseGridInput): PressureLevel[] {
  const byId = new Map<string, { z: number; label: string }>()
  for (const method of Object.values(data.methods)) {
    for (const frame of method.frames) {
      for (const [id, grid] of Object.entries(frame.levels)) {
        if (!byId.has(id)) byId.set(id, { z: grid.z, label: grid.label })
      }
    }
  }
  if (byId.size === 0) return []

  const ordered = [...byId.entries()].sort((a, b) => a[1].z - b[1].z)
  const n = ordered.length
  const span = LEVEL_BAND_MAX - LEVEL_BAND_MIN
  const gap = (span / n) * 0.12  // small visual separation between bands

  return ordered.map(([id, { z, label }], i) => ({
    id,
    label,
    z,
    visible: true,
    opacity: 1.0,
    baseAltitude: LEVEL_BAND_MIN + (span * i) / n,
    topAltitude: LEVEL_BAND_MIN + (span * (i + 1)) / n - gap,
  }))
}
