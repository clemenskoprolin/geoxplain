/**
 * Worker-safe CPU volume builder for attribution textures.
 *
 * Sparse points are stamped into equirectangular W x H x Z grids and normalized
 * globally so pressure-level intensities remain comparable.
 */

// Volume dimensions: high enough for detail, built off-thread.
export const VOL_W = 512
export const VOL_H = 256
export const VOL_Z = 24

const SMOOTH_FLAT_MAX_W = 1024
const SMOOTH_FLAT_MAX_H = 512
const SMOOTH_FLAT_MAX_SCALE = 2

// Match globe.gl heatmapBandwidth = 2.5 degrees on a 512-wide grid.
const SIGMA_PX = 3.56
const KERNEL_PX = 11

// Altitude blending falloff, tighter for compressed layers.
const ALT_BLEND = 0.005

// Imported dense grids are normalized per pressure level before encoding.
// A small deadband/floor applied during XY smoothing keeps the near-neutral
// background from blurring into a visible haze.
const DENSE_SMOOTH_DIVERGING_DEADBAND = 0.02
const DENSE_SMOOTH_SEQUENTIAL_FLOOR = 0.03

// Precomputed Gaussian kernel LUT (only depends on constants above)
const KERNEL_SIZE = KERNEL_PX * 2 + 1
const KERNEL_LUT = new Float32Array(KERNEL_SIZE * KERNEL_SIZE)
const sigma2 = SIGMA_PX * SIGMA_PX
const r2max = KERNEL_PX * KERNEL_PX
for (let ky = 0; ky < KERNEL_SIZE; ky++) {
  const dy = ky - KERNEL_PX
  for (let kx = 0; kx < KERNEL_SIZE; kx++) {
    const dx = kx - KERNEL_PX
    const d2 = dx * dx + dy * dy
    KERNEL_LUT[ky * KERNEL_SIZE + kx] = d2 <= r2max ? Math.exp(-d2 / (2 * sigma2)) : 0
  }
}

/** Minimal point representation for worker serialization */
export interface VolumePoint {
  x: number       // longitude
  y: number       // latitude
  intensity: number
  pressureLevelId: string
}

/** Minimal pressure level representation for worker serialization */
export interface VolumeLevel {
  id: string
  visible: boolean
  opacity: number
  baseAltitude: number
  topAltitude: number
}

export interface BuildVolumeParams {
  points: VolumePoint[]
  levels: VolumeLevel[]
}

export interface DenseGridVolumeInput {
  shape: [number, number]  // [H, W]
  dataU8: Uint8Array
}

export interface BuildVolumeFromGridsParams {
  grids: Record<string, DenseGridVolumeInput>
  levels: VolumeLevel[]
  diverging?: boolean
  smoothEnabled?: boolean
  smoothSigma?: number
  /**
   * Absolute mode: fold a diverging (0.5-centred) field to magnitude
   * `|v − 0.5| · 2` and build it as a plain sequential field. Used by the
   * "Signed values" UI toggle when turned off.
   */
  absolute?: boolean
}

export interface DenseGridShape {
  width: number
  height: number
}

export interface DenseGridBuildInfo extends DenseGridShape {
  depth: number
  useLinearFiltering: boolean
}

export interface DenseGridBuildResult extends DenseGridBuildInfo {
  data: Uint8Array
}

interface GaussianKernel1D {
  weights: Float32Array
  radius: number
}

const gaussianKernelCache = new Map<string, GaussianKernel1D>()

export function resolveDenseGridShape(
  grids: Record<string, DenseGridVolumeInput>,
): DenseGridShape {
  let height = 0
  let width = 0

  for (const [levelId, grid] of Object.entries(grids)) {
    const [gridH, gridW] = grid.shape
    if (!Number.isInteger(gridH) || !Number.isInteger(gridW) || gridH <= 0 || gridW <= 0) {
      throw new Error(`Dense grid ${levelId} has invalid shape ${grid.shape.join('x')}`)
    }
    if (grid.dataU8.length !== gridH * gridW) {
      throw new Error(`Dense grid ${levelId} shape ${gridH}x${gridW} does not match ${grid.dataU8.length} bytes`)
    }
    if (height === 0 && width === 0) {
      height = gridH
      width = gridW
      continue
    }
    if (height !== gridH || width !== gridW) {
      throw new Error(`Dense grids must share one shape, got ${height}x${width} and ${gridH}x${gridW}`)
    }
  }

  return height > 0 && width > 0
    ? { width, height }
    : { width: VOL_W, height: VOL_H }
}

export function resolveDenseGridBuildInfo(
  grids: Record<string, DenseGridVolumeInput>,
  smoothEnabled = false,
): DenseGridBuildInfo {
  const nativeShape = resolveDenseGridShape(grids)
  // Sharp, unsmoothed grids keep native resolution with nearest filtering.
  if (!smoothEnabled) {
    return {
      width: nativeShape.width,
      height: nativeShape.height,
      depth: VOL_Z,
      useLinearFiltering: false,
    }
  }

  const scale = Math.max(
    1,
    Math.min(
      SMOOTH_FLAT_MAX_SCALE,
      SMOOTH_FLAT_MAX_W / nativeShape.width,
      SMOOTH_FLAT_MAX_H / nativeShape.height,
    ),
  )

  return {
    width: Math.max(1, Math.round(nativeShape.width * scale)),
    height: Math.max(1, Math.round(nativeShape.height * scale)),
    depth: VOL_Z,
    useLinearFiltering: true,
  }
}

function encodeUnitToU8(value: number): number {
  return value >= 1 ? 255 : value <= 0 ? 0 : (value * 255 + 0.5) | 0
}

function wrapIndex(index: number, size: number): number {
  return ((index % size) + size) % size
}

function reflectIndex(index: number, size: number): number {
  if (size <= 1) return 0

  let reflected = index
  while (reflected < 0 || reflected >= size) {
    reflected = reflected < 0
      ? -reflected - 1
      : size * 2 - reflected - 1
  }
  return reflected
}

function getGaussianKernel1D(sigma: number): GaussianKernel1D {
  const clampedSigma = Math.max(0.01, sigma)
  const cacheKey = clampedSigma.toFixed(2)
  const cached = gaussianKernelCache.get(cacheKey)
  if (cached) return cached

  const radius = Math.max(1, Math.ceil(clampedSigma * 3))
  const weights = new Float32Array(radius * 2 + 1)
  const sigma2 = clampedSigma * clampedSigma
  let sum = 0

  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma2))
    weights[offset + radius] = weight
    sum += weight
  }

  const invSum = sum > 0 ? 1 / sum : 1
  for (let i = 0; i < weights.length; i++) {
    weights[i] *= invSum
  }

  const kernel = { weights, radius }
  gaussianKernelCache.set(cacheKey, kernel)
  return kernel
}

function decodeGridToFloat(grid: DenseGridVolumeInput): Float32Array {
  const decoded = new Float32Array(grid.dataU8.length)
  for (let i = 0; i < grid.dataU8.length; i++) {
    decoded[i] = grid.dataU8[i] / 255
  }
  return decoded
}

function resampleDenseGridBilinear(
  source: Float32Array,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Float32Array {
  if (sourceW === targetW && sourceH === targetH) {
    return source
  }

  const resampled = new Float32Array(targetW * targetH)

  for (let y = 0; y < targetH; y++) {
    const sourceY = targetH === 1 ? 0 : (y * (sourceH - 1)) / (targetH - 1)
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(sourceH - 1, y0 + 1)
    const ty = sourceY - y0
    const row0 = y0 * sourceW
    const row1 = y1 * sourceW
    const targetRow = y * targetW

    for (let x = 0; x < targetW; x++) {
      const sourceX = (x * sourceW) / targetW
      const x0 = Math.floor(sourceX)
      const x1 = wrapIndex(x0 + 1, sourceW)
      const tx = sourceX - x0

      const top = source[row0 + x0] * (1 - tx) + source[row0 + x1] * tx
      const bottom = source[row1 + x0] * (1 - tx) + source[row1 + x1] * tx
      resampled[targetRow + x] = top * (1 - ty) + bottom * ty
    }
  }

  return resampled
}

function smoothDenseGridXY(
  grid: DenseGridVolumeInput,
  sigma: number,
  diverging: boolean,
): Float32Array {
  const [H, W] = grid.shape
  const source = decodeGridToFloat(grid)
  const working = new Float32Array(source.length)
  if (diverging) {
    for (let i = 0; i < source.length; i++) {
      const signed = source[i] - 0.5
      const magnitude = Math.abs(signed)
      working[i] = magnitude <= DENSE_SMOOTH_DIVERGING_DEADBAND
        ? 0
        : Math.sign(signed) * (magnitude - DENSE_SMOOTH_DIVERGING_DEADBAND)
    }
  } else {
    for (let i = 0; i < source.length; i++) {
      working[i] = source[i] <= DENSE_SMOOTH_SEQUENTIAL_FLOOR
        ? 0
        : source[i] - DENSE_SMOOTH_SEQUENTIAL_FLOOR
    }
  }

  const { weights, radius } = getGaussianKernel1D(sigma)
  const temp = new Float32Array(source.length)
  const smoothed = new Float32Array(source.length)

  for (let y = 0; y < H; y++) {
    const rowOff = y * W
    for (let x = 0; x < W; x++) {
      let acc = 0
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = wrapIndex(x + offset, W)
        acc += working[rowOff + sampleX] * weights[offset + radius]
      }
      temp[rowOff + x] = acc
    }
  }

  for (let y = 0; y < H; y++) {
    const rowOff = y * W
    for (let x = 0; x < W; x++) {
      let acc = 0
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = reflectIndex(y + offset, H)
        acc += temp[sampleY * W + x] * weights[offset + radius]
      }
      smoothed[rowOff + x] = acc
    }
  }

  if (diverging) {
    for (let i = 0; i < smoothed.length; i++) {
      smoothed[i] = Math.max(0, Math.min(1, smoothed[i] + 0.5))
    }
  }
  return smoothed
}

function buildDenseGridSamples(
  grids: Record<string, DenseGridVolumeInput>,
  levels: VolumeLevel[],
  smoothEnabled: boolean,
  smoothSigma: number,
  diverging: boolean,
  absolute: boolean,
  targetShape: DenseGridShape,
): Map<string, Float32Array> {
  const samples = new Map<string, Float32Array>()
  // In absolute mode the source field is always diverging-encoded (0.5 = zero);
  // smooth it sign-preserving, then fold to magnitude so the downstream build
  // treats it as a plain sequential field.
  const sourceDiverging = absolute || diverging
  for (const level of levels) {
    if (!level.visible || level.opacity <= 0) continue
    const grid = grids[level.id]
    if (!grid) continue
    const [sourceH, sourceW] = grid.shape
    let source = smoothEnabled ? smoothDenseGridXY(grid, smoothSigma, sourceDiverging) : decodeGridToFloat(grid)
    if (absolute) {
      const folded = new Float32Array(source.length)
      for (let i = 0; i < source.length; i++) {
        folded[i] = Math.min(1, Math.abs(source[i] - 0.5) * 2)
      }
      source = folded
    }
    samples.set(
      level.id,
      resampleDenseGridBilinear(source, sourceW, sourceH, targetShape.width, targetShape.height),
    )
  }
  return samples
}

function buildFlatVolumeDataFromGrids(
  gridSamples: Map<string, Float32Array>,
  levels: VolumeLevel[],
  diverging: boolean,
  W: number,
  H: number,
  Z: number,
): Uint8Array {
  const visibleLevels = levels.filter(l => l.visible && l.opacity > 0 && gridSamples.has(l.id))
  const nLevels = visibleLevels.length
  const data = new Uint8Array(W * H * Z)
  if (nLevels === 0) {
    if (diverging) data.fill(128)
    return data
  }

  const fused = new Uint8Array(W * H)
  const neutral = diverging ? 0.5 : 0.0

  // Per pixel, take the strongest (max-magnitude) visible level.
  for (let iy = 0; iy < H; iy++) {
    const rowOff = iy * W
    for (let ix = 0; ix < W; ix++) {
      const gridIdx = rowOff + ix
      let bestMag = -1
      let bestSample = 0

      for (let li = 0; li < nLevels; li++) {
        const level = visibleLevels[li]
        const rawValue = gridSamples.get(level.id)![gridIdx]
        const sample = diverging ? rawValue - 0.5 : rawValue
        const mag = Math.abs(sample) * level.opacity
        if (mag > bestMag) {
          bestMag = mag
          bestSample = sample
        }
      }

      fused[gridIdx] = encodeUnitToU8(bestSample + neutral)
    }
  }

  for (let iz = 0; iz < Z; iz++) {
    const sliceOff = iz * W * H
    for (let i = 0; i < fused.length; i++) {
      data[sliceOff + i] = fused[i]
    }
  }

  return data
}

/**
 * Build volume from pre-computed dense 2D grids (one per pressure level).
 * Visible levels are fused into one raster and replicated through Z.
 */
export function buildVolumeDataFromGrids(params: BuildVolumeFromGridsParams): DenseGridBuildResult {
  const {
    grids,
    levels,
    diverging = false,
    smoothEnabled = false,
    smoothSigma = 1.5,
    absolute = false,
  } = params
  // Folded magnitudes are a plain sequential field, so the fuse/encode step runs
  // in sequential mode even though the source data was diverging-encoded.
  const buildDiverging = diverging && !absolute
  const buildInfo = resolveDenseGridBuildInfo(grids, smoothEnabled)
  const { width: W, height: H, depth: Z } = buildInfo
  const gridSamples = buildDenseGridSamples(grids, levels, smoothEnabled, smoothSigma, buildDiverging, absolute, buildInfo)
  const data = buildFlatVolumeDataFromGrids(gridSamples, levels, buildDiverging, W, H, Z)

  return {
    data,
    width: buildInfo.width,
    height: buildInfo.height,
    depth: buildInfo.depth,
    useLinearFiltering: buildInfo.useLinearFiltering,
  }
}

/**
 * Build volume data as a raw Uint8Array (W × H × Z, single channel).
 * Can be called on main thread or in a Web Worker.
 */
export function buildVolumeData(params: BuildVolumeParams): Uint8Array {
  const { points, levels } = params
  const W = VOL_W, H = VOL_H, Z = VOL_Z

  const visibleLevels = levels.filter(l => l.visible && l.opacity > 0)

  // Pre-group points by level ID to avoid repeated .filter() calls
  const pointsByLevel = new Map<string, VolumePoint[]>()
  for (const pt of points) {
    let arr = pointsByLevel.get(pt.pressureLevelId)
    if (!arr) {
      arr = []
      pointsByLevel.set(pt.pressureLevelId, arr)
    }
    arr.push(pt)
  }

  // Overall altitude range
  let minBase = Infinity, maxTop = -Infinity
  for (const l of levels) {
    if (l.baseAltitude < minBase) minBase = l.baseAltitude
    if (l.topAltitude > maxTop) maxTop = l.topAltitude
  }
  const altRange = maxTop - minBase || 1

  // Pre-rasterize each pressure level into a W×H 2D grid
  const levelGrids: { grid: Float32Array; level: VolumeLevel }[] = []

  // Track global max across ALL levels for normalization
  let globalMax = 0

  for (const level of visibleLevels) {
    const grid = new Float32Array(W * H)
    const levelPoints = pointsByLevel.get(level.id)
    if (!levelPoints) {
      levelGrids.push({ grid, level })
      continue
    }

    for (const pt of levelPoints) {
      const px = ((pt.x + 180) / 360) * W
      const py = ((90 - pt.y) / 180) * H
      const intensity = pt.intensity

      const r = KERNEL_PX
      const x0 = Math.floor(px - r)
      const y0 = Math.max(0, Math.floor(py - r))
      const y1 = Math.min(H - 1, Math.ceil(py + r))

      // Use integer offsets into the precomputed kernel
      const kxBase = Math.round(KERNEL_PX - (px - x0))
      const kyBase = Math.round(KERNEL_PX - (py - y0))

      for (let iy = y0; iy <= y1; iy++) {
        const ky = iy - y0 + kyBase
        if (ky < 0 || ky >= KERNEL_SIZE) continue
        const kernelRowOff = ky * KERNEL_SIZE
        const gridRowOff = iy * W

        for (let kx = 0; kx < KERNEL_SIZE; kx++) {
          const w = KERNEL_LUT[kernelRowOff + kx]
          if (w === 0) continue
          const ix = x0 + kx - kxBase
          const wx = ((ix % W) + W) % W
          grid[gridRowOff + wx] += intensity * w
        }
      }
    }

    // Track global max (NOT normalizing per-level)
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > globalMax) globalMax = grid[i]
    }

    levelGrids.push({ grid, level })
  }

  // Normalize all grids by the global max so relative intensities are preserved
  if (globalMax > 0) {
    const invMax = 1 / globalMax
    for (const { grid } of levelGrids) {
      for (let i = 0; i < grid.length; i++) {
        grid[i] *= invMax
      }
    }
  }

  // Build volume texture data: W × H × Z, single-channel Uint8
  const data = new Uint8Array(W * H * Z)

  // Precompute altitude weights per (iz, levelIdx) to avoid repeated Math.exp in inner loop
  const nLevels = levelGrids.length
  const altWeights = new Float32Array(Z * nLevels)
  for (let iz = 0; iz < Z; iz++) {
    const alt = minBase + (iz / (Z - 1)) * altRange
    for (let li = 0; li < nLevels; li++) {
      const level = levelGrids[li].level
      const midAlt = (level.baseAltitude + level.topAltitude) / 2
      const dist = Math.abs(alt - midAlt)
      const bandHalf = (level.topAltitude - level.baseAltitude) / 2
      altWeights[iz * nLevels + li] = Math.exp(-Math.max(0, dist - bandHalf) / ALT_BLEND) * level.opacity
    }
  }

  for (let iz = 0; iz < Z; iz++) {
    const sliceOff = iz * W * H
    const weightOff = iz * nLevels

    for (let iy = 0; iy < H; iy++) {
      const rowOff = iy * W

      for (let ix = 0; ix < W; ix++) {
        let density = 0
        const gridIdx = rowOff + ix

        for (let li = 0; li < nLevels; li++) {
          density += levelGrids[li].grid[gridIdx] * altWeights[weightOff + li]
        }

        data[sliceOff + gridIdx] = density >= 1 ? 255 : (density * 255 + 0.5) | 0
      }
    }
  }

  return data
}
