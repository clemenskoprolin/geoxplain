import type { AttributionColorScheme, AttributionColorStop, AttributionPresetColormap } from '@/types'

export const CUSTOM_ATTRIBUTION_STOP_LIMIT = 8

const PRESET_IDS: Record<AttributionPresetColormap, number> = {
  default: 0,
  rdbu: 1,
  coolwarm: 2,
  'purple-green': 3,
  reds: 4,
  viridis: 5,
  plasma: 6,
  magma: 7,
  inferno: 8,
  cividis: 9,
  'contour-default': 10,
  'contour-amber': 11,
  'contour-teal': 12,
  'contour-blue-red': 13,
  'contour-green-magenta': 14,
  'contour-custom': 15,
}

const FALLBACK_COLOR: [number, number, number] = [0, 0, 0]

export const ATTRIBUTION_COLORMAP_LABELS: Record<AttributionPresetColormap, string> = {
  default: 'Default',
  rdbu: 'RdBu',
  coolwarm: 'Coolwarm',
  'purple-green': 'Purple-Green',
  reds: 'Reds',
  viridis: 'Viridis',
  plasma: 'Plasma',
  magma: 'Magma',
  inferno: 'Inferno',
  cividis: 'Cividis',
  'contour-default': 'Blue',
  'contour-amber': 'Amber',
  'contour-teal': 'Teal',
  'contour-blue-red': 'Blue-Red',
  'contour-green-magenta': 'Green-Magenta',
  'contour-custom': 'Custom',
}

/** Default preset in sequential (non-diverging) mode — warm saliency ramp. */
export const ATTRIBUTION_DEFAULT_SEQUENTIAL_GRADIENT =
  'linear-gradient(to right, #fff7ec, #fdd49e, #fc8d59, #d7301f, #7f0000)'

/** Default preset in diverging mode — RdBu_r-style ramp used by the renderer. */
export const ATTRIBUTION_DEFAULT_DIVERGING_GRADIENT =
  'linear-gradient(to right, #053061, #4393c3, #f7f7f7, #d6604d, #67001f)'

export const ATTRIBUTION_COLORMAP_GRADIENTS: Record<AttributionPresetColormap, string> = {
  default: ATTRIBUTION_DEFAULT_SEQUENTIAL_GRADIENT,
  rdbu: 'linear-gradient(to right, #053061, #4393c3, #f7f7f7, #d6604d, #67001f)',
  coolwarm: 'linear-gradient(to right, #3b4cc0, #8db0fe, #dddcdc, #f4987a, #b40426)',
  'purple-green': 'linear-gradient(to right, #40004b, #9970ab, #f7f7f7, #5aae61, #00441b)',
  reds: 'linear-gradient(to right, #fff5eb, #fdd0a2, #fb6a4a, #cb181d, #800026)',
  viridis: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)',
  plasma: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)',
  magma: 'linear-gradient(to right, #000004, #3b0f70, #8c2981, #de4968, #fcfdbf)',
  inferno: 'linear-gradient(to right, #000004, #420a68, #932667, #dd513a, #fcffa4)',
  cividis: 'linear-gradient(to right, #00204c, #31446b, #666870, #958f78, #fee838)',
  'contour-default': '#1a37a0',
  'contour-amber': '#f28f14',
  'contour-teal': '#1cb8c4',
  'contour-blue-red': 'linear-gradient(to right, #0a2e8a 50%, #c93018 50%)',
  'contour-green-magenta': 'linear-gradient(to right, #0a5922 50%, #c025a0 50%)',
  'contour-custom': '#888888',
}

export const DEFAULT_ATTRIBUTION_COLOR_SCHEME: AttributionColorScheme = {
  type: 'preset',
  name: 'default',
}

const ATTRIBUTION_DIVERGING_PALETTES = ['coolwarm', 'purple-green'] as const
const ATTRIBUTION_SEQUENTIAL_PALETTES = ['viridis', 'plasma', 'magma', 'inferno', 'cividis'] as const

/** CSS gradient for a palette swatch; default adapts to diverging vs sequential data. */
export function attributionPaletteGradient(
  palette: AttributionPresetColormap,
  diverging: boolean,
): string {
  if (palette === 'default') {
    return diverging
      ? ATTRIBUTION_DEFAULT_DIVERGING_GRADIENT
      : ATTRIBUTION_DEFAULT_SEQUENTIAL_GRADIENT
  }
  return ATTRIBUTION_COLORMAP_GRADIENTS[palette]
}

/** Human-readable label; default resolves to its effective ramp (RdBu or Reds). */
export function attributionPaletteLabel(
  palette: AttributionPresetColormap,
  diverging: boolean,
): string {
  if (palette === 'default') {
    return diverging
      ? ATTRIBUTION_COLORMAP_LABELS.rdbu
      : ATTRIBUTION_COLORMAP_LABELS.reds
  }
  return ATTRIBUTION_COLORMAP_LABELS[palette]
}

/** Order UI palettes with mode-appropriate presets first. */
export function orderedAttributionUiPalettes(diverging: boolean): AttributionPresetColormap[] {
  if (diverging) {
    return ['default', ...ATTRIBUTION_DIVERGING_PALETTES, ...ATTRIBUTION_SEQUENTIAL_PALETTES]
  }
  return ['default', ...ATTRIBUTION_SEQUENTIAL_PALETTES, ...ATTRIBUTION_DIVERGING_PALETTES]
}

/** Exactly 4 contour-specific palettes, mode-appropriate ones first.
 *  When hasCustom is true the 4th slot is always replaced by 'contour-custom'. */
export function orderedContourPalettes(diverging: boolean, hasCustom = false): AttributionPresetColormap[] {
  const base: AttributionPresetColormap[] = diverging
    ? ['contour-blue-red', 'contour-green-magenta', 'contour-default', 'contour-amber']
    : ['contour-default', 'contour-amber', 'contour-blue-red', 'contour-green-magenta']
  if (hasCustom) base[3] = 'contour-custom'
  return base
}

/** CSS gradient string for a custom AttributionColorScheme, for use in palette swatches. */
export function customColorSchemeGradientCss(scheme: AttributionColorScheme | undefined): string {
  if (!scheme || scheme.type !== 'custom' || scheme.stops.length === 0) return '#888888'
  const toInt = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  const parts = [...scheme.stops]
    .sort((a, b) => a.position - b.position)
    .map(({ position, color: [r, g, b] }) =>
      `rgb(${toInt(r)} ${toInt(g)} ${toInt(b)}) ${Math.round(position * 100)}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

export function attributionColorSchemeId(scheme: AttributionColorScheme): number {
  return scheme.type === 'preset' ? PRESET_IDS[scheme.name] ?? 0 : 100
}

// ── Preset ramp anchor tables ────────────────────────────────────────────────
// These mirror, EXACTLY, the GLSL colorRamp* anchor colours that used to live in
// shaders/shared.ts. The presets are now baked into a 256-entry lookup texture on
// the CPU (see attributionRampStops) and sampled by the shader as a single
// texture() fetch, instead of being inlined as ~10 branchy GLSL functions — that
// inlining is what pushed the cold ANGLE/D3D11 shader compile to ~28s. Evenly
// spacing N anchors over [0,1] reproduces the GLSL `mix` between the same
// anchors, so the rendered colours are unchanged (bar 8-bit LUT quantisation).
type Rgb = [number, number, number]

function evenStops(colors: Rgb[]): AttributionColorStop[] {
  const last = colors.length - 1
  return colors.map((color, i) => ({ position: last === 0 ? 0 : i / last, color }))
}

// RdBu_r — used by the `default` (diverging) and `rdbu` presets.
const RAMP_DIVERGING: Rgb[] = [
  [0.0196, 0.1882, 0.3804], [0.1294, 0.4, 0.6745], [0.2627, 0.5765, 0.7647],
  [0.5725, 0.7725, 0.8706], [0.8196, 0.898, 0.9412], [0.9686, 0.9686, 0.9686],
  [0.9922, 0.8588, 0.7804], [0.9569, 0.6471, 0.5098], [0.8392, 0.3765, 0.302],
  [0.698, 0.0941, 0.1686], [0.4039, 0.0, 0.1216],
]
// Warm saliency ramp — used by the `default` (sequential) and `reds` presets.
const RAMP_SEQUENTIAL: Rgb[] = [
  [1.0, 0.9686, 0.9255], [0.9961, 0.8784, 0.7529], [0.9882, 0.7333, 0.6314],
  [0.9569, 0.502, 0.3765], [0.8392, 0.1882, 0.1529], [0.498, 0.0, 0.0],
]
const RAMP_COOLWARM: Rgb[] = [
  [0.2298, 0.2987, 0.7537], [0.5543, 0.6901, 0.9955], [0.8674, 0.8644, 0.8626],
  [0.9567, 0.598, 0.4773], [0.7057, 0.0156, 0.1502],
]
const RAMP_PURPLE_GREEN: Rgb[] = [
  [0.2509, 0.0, 0.2941], [0.4627, 0.1647, 0.5137], [0.7627, 0.6471, 0.8118],
  [0.9686, 0.9686, 0.9686], [0.651, 0.8588, 0.6275], [0.3529, 0.6824, 0.3804],
  [0.0, 0.2667, 0.1059],
]
const RAMP_VIRIDIS: Rgb[] = [
  [0.267, 0.005, 0.329], [0.254, 0.265, 0.53], [0.164, 0.471, 0.558],
  [0.135, 0.659, 0.518], [0.478, 0.821, 0.318], [0.993, 0.906, 0.144],
]
const RAMP_PLASMA: Rgb[] = [
  [0.05, 0.03, 0.528], [0.416, 0.001, 0.659], [0.692, 0.165, 0.565],
  [0.881, 0.393, 0.383], [0.988, 0.652, 0.211], [0.94, 0.975, 0.131],
]
const RAMP_MAGMA: Rgb[] = [
  [0.001, 0.0, 0.014], [0.171, 0.067, 0.373], [0.445, 0.122, 0.506],
  [0.716, 0.215, 0.475], [0.944, 0.378, 0.365], [0.987, 0.991, 0.749],
]
const RAMP_INFERNO: Rgb[] = [
  [0.001, 0.0, 0.014], [0.193, 0.059, 0.32], [0.472, 0.11, 0.428],
  [0.73, 0.213, 0.333], [0.929, 0.411, 0.145], [0.988, 0.998, 0.645],
]
const RAMP_CIVIDIS: Rgb[] = [
  [0.0, 0.135, 0.305], [0.209, 0.272, 0.424], [0.373, 0.382, 0.433],
  [0.553, 0.522, 0.42], [0.738, 0.682, 0.424], [0.996, 0.909, 0.218],
]
// Contour-specific ramps — designed for isoline color clarity, not filled areas.
const RAMP_CONTOUR_DEFAULT: Rgb[] = [
  [0.102, 0.216, 0.627], [0.102, 0.216, 0.627], // uniform dark blue
]
const RAMP_CONTOUR_AMBER: Rgb[] = [
  [0.949, 0.561, 0.078], [0.949, 0.561, 0.078], // uniform warm amber
]
const RAMP_CONTOUR_TEAL: Rgb[] = [
  [0.11, 0.722, 0.769], [0.11, 0.722, 0.769], // uniform teal
]
// Hard-cut two-color ramps: [0, 0.499] = color A, [0.501, 1] = color B, step at t=0.5 (zero crossing).
const C_BLUE: Rgb = [0.039, 0.18, 0.541]
const C_RED: Rgb = [0.788, 0.188, 0.094]
const C_GREEN: Rgb = [0.039, 0.349, 0.133]
const C_MAGENTA: Rgb = [0.753, 0.145, 0.627]
const STOPS_CONTOUR_BLUE_RED: AttributionColorStop[] = [
  { position: 0.0, color: C_BLUE }, { position: 0.499, color: C_BLUE },
  { position: 0.501, color: C_RED }, { position: 1.0, color: C_RED },
]
const STOPS_CONTOUR_GREEN_MAGENTA: AttributionColorStop[] = [
  { position: 0.0, color: C_GREEN }, { position: 0.499, color: C_GREEN },
  { position: 0.501, color: C_MAGENTA }, { position: 1.0, color: C_MAGENTA },
]

/**
 * The colour stops that define a scheme's ramp, for baking into the shader's
 * lookup texture. Custom schemes return their own stops; presets return their
 * anchor table. `default` resolves to RdBu_r when diverging, else the warm ramp —
 * matching the GLSL dispatch that branched on divergingMode for scheme id 0.
 */
export function attributionRampStops(
  scheme: AttributionColorScheme,
  diverging: boolean,
): AttributionColorStop[] {
  if (scheme.type === 'custom') return scheme.stops
  switch (scheme.name) {
    case 'default': return evenStops(diverging ? RAMP_DIVERGING : RAMP_SEQUENTIAL)
    case 'rdbu': return evenStops(RAMP_DIVERGING)
    case 'coolwarm': return evenStops(RAMP_COOLWARM)
    case 'purple-green': return evenStops(RAMP_PURPLE_GREEN)
    case 'reds': return evenStops(RAMP_SEQUENTIAL)
    case 'viridis': return evenStops(RAMP_VIRIDIS)
    case 'plasma': return evenStops(RAMP_PLASMA)
    case 'magma': return evenStops(RAMP_MAGMA)
    case 'inferno': return evenStops(RAMP_INFERNO)
    case 'cividis': return evenStops(RAMP_CIVIDIS)
    case 'contour-default': return evenStops(RAMP_CONTOUR_DEFAULT)
    case 'contour-amber': return evenStops(RAMP_CONTOUR_AMBER)
    case 'contour-teal': return evenStops(RAMP_CONTOUR_TEAL)
    case 'contour-blue-red': return STOPS_CONTOUR_BLUE_RED
    case 'contour-green-magenta': return STOPS_CONTOUR_GREEN_MAGENTA
    case 'contour-custom': return evenStops(diverging ? RAMP_DIVERGING : RAMP_SEQUENTIAL)
    default: return evenStops(diverging ? RAMP_DIVERGING : RAMP_SEQUENTIAL)
  }
}

export function attributionColorSchemeSignature(scheme: AttributionColorScheme): string {
  if (scheme.type === 'preset') return `preset:${scheme.name}`
  return `custom:${scheme.stops.map((stop) => (
    `${stop.position.toFixed(4)}:${stop.color.map((value) => value.toFixed(4)).join(',')}`
  )).join('|')}`
}

export function attributionColorSchemeStops(scheme: AttributionColorScheme): {
  count: number
  positions: number[]
  colors: Array<[number, number, number]>
} {
  const sourceStops = scheme.type === 'custom' ? scheme.stops : []
  const count = Math.min(sourceStops.length, CUSTOM_ATTRIBUTION_STOP_LIMIT)
  const positions: number[] = []
  const colors: Array<[number, number, number]> = []

  for (let i = 0; i < CUSTOM_ATTRIBUTION_STOP_LIMIT; i++) {
    const stop = sourceStops[i]
    positions.push(stop?.position ?? 0)
    colors.push(stop?.color ?? FALLBACK_COLOR)
  }

  return { count, positions, colors }
}
