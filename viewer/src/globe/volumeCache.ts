import * as THREE from 'three'
import type { AttributionPoint, DenseLevelGrid, PressureLevel } from '@/types'
import VolumeWorker from './volumeWorker?worker&inline'
import {
  VOL_W,
  VOL_H,
  VOL_Z,
  buildVolumeData,
  buildVolumeDataFromGrids,
  resolveDenseGridBuildInfo,
} from './volume'

const MAX_ENTRIES = 8
const MAX_CACHE_BYTES = 192 * 1024 * 1024

interface CacheEntry {
  key: string
  texture: THREE.Data3DTexture
  byteSize: number
}

interface DenseBuildOptions {
  diverging?: boolean
  smoothEnabled?: boolean
  smoothSigma?: number
  absolute?: boolean
}

interface NormalizedDenseBuildOptions {
  diverging: boolean
  smoothEnabled: boolean
  smoothSigma: number
  absolute: boolean
}

interface WorkerResponse {
  id: string
  data: Uint8Array
  width: number
  height: number
  depth: number
  useLinearFiltering?: boolean
}

type PendingBuild =
  | {
    kind: 'points'
    points: AttributionPoint[]
    pressureLevels: PressureLevel[]
    resolvers: Array<(tex: THREE.Data3DTexture) => void>
  }
  | {
    kind: 'grids'
    grids: Record<string, DenseLevelGrid>
    pressureLevels: PressureLevel[]
    options: NormalizedDenseBuildOptions
    resolvers: Array<(tex: THREE.Data3DTexture) => void>
  }

/** Wrap raw Uint8Array in a Data3DTexture */
function dataToTexture(
  data: Uint8Array,
  width: number,
  height: number,
  depth: number,
  minFilter: THREE.MinificationTextureFilter = THREE.LinearFilter,
  magFilter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(data, width, height, depth)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = minFilter
  tex.magFilter = magFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.wrapR = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

/** Try to create the volume worker; returns null if it fails */
function tryCreateWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    return new VolumeWorker()
  } catch {
    return null
  }
}

/**
 * LRU cache for Data3DTexture volumes.
 * Builds off-thread via Web Worker when available, falls back to main-thread.
 */
export class VolumeCache {
  private entries: CacheEntry[] = []
  private totalBytes = 0
  private worker: Worker | null = null
  private pending = new Map<string, PendingBuild>()

  constructor() {
    this.worker = tryCreateWorker()
    if (this.worker) {
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const {
          id,
          data,
          width,
          height,
          depth,
          useLinearFiltering = true,
        } = e.data
        const filter = useLinearFiltering ? THREE.LinearFilter : THREE.NearestFilter
        this.insertAndResolve(
          id,
          dataToTexture(data, width, height, depth, filter, filter),
          data.byteLength,
        )
      }
      // If the worker errors, resolve pending with a main-thread fallback
      this.worker.onerror = () => {
        // Worker is broken — kill it and fall back to sync builds
        this.worker?.terminate()
        this.worker = null

        const pending = Array.from(this.pending.entries())
        this.pending.clear()
        for (const [key, build] of pending) {
          const tex = this.buildPendingSync(key, build)
          for (const resolve of build.resolvers) {
            resolve(tex)
          }
        }
      }
    }
  }

  private insert(key: string, tex: THREE.Data3DTexture, byteSize: number): THREE.Data3DTexture {
    this.evictIfNeeded(byteSize)
    this.entries.push({ key, texture: tex, byteSize })
    this.totalBytes += byteSize
    return tex
  }

  private evictIfNeeded(nextBytes: number) {
    while (
      this.entries.length >= MAX_ENTRIES ||
      (this.entries.length > 0 && this.totalBytes + nextBytes > MAX_CACHE_BYTES)
    ) {
      // Remove from cache but do NOT dispose — the texture may still be
      // bound to shader uniforms (uTexPrev/uTexNext). Disposal happens
      // in Globe.tsx when the texture is no longer referenced anywhere.
      const evicted = this.entries.shift()
      if (!evicted) break
      this.totalBytes -= evicted.byteSize
    }
  }

  private insertAndResolve(key: string, tex: THREE.Data3DTexture, byteSize: number) {
    this.insert(key, tex, byteSize)

    const build = this.pending.get(key)
    this.pending.delete(key)
    if (build) {
      for (const resolve of build.resolvers) {
        resolve(tex)
      }
    }
  }

  static plSignature(levels: PressureLevel[]): string {
    return levels
      .map(pl => `${pl.id}:${pl.visible ? 1 : 0}:${pl.opacity.toFixed(2)}`)
      .join('|')
  }

  static cacheKey(frameKey: string, levels: PressureLevel[]): string {
    return `${frameKey}__${VolumeCache.plSignature(levels)}`
  }

  private static normalizeDenseBuildOptions(options: DenseBuildOptions = {}): NormalizedDenseBuildOptions {
    return {
      diverging: options.diverging ?? false,
      smoothEnabled: options.smoothEnabled ?? false,
      smoothSigma: options.smoothSigma ?? 1.5,
      absolute: options.absolute ?? false,
    }
  }

  private getCached(key: string): THREE.Data3DTexture | null {
    const idx = this.entries.findIndex(e => e.key === key)
    if (idx === -1) return null
    const [entry] = this.entries.splice(idx, 1)
    this.entries.push(entry)
    return entry.texture
  }

  /** Serialize points/levels into the plain-object format the worker expects */
  private static serialize(points: AttributionPoint[], levels: PressureLevel[]) {
    return {
      points: points.map(p => ({
        x: p.x, y: p.y, intensity: p.intensity, pressureLevelId: p.pressureLevelId,
      })),
      levels: levels.map(l => ({
        id: l.id, visible: l.visible, opacity: l.opacity,
        baseAltitude: l.baseAltitude, topAltitude: l.topAltitude,
      })),
    }
  }

  /** Build synchronously on the main thread (fallback) */
  private buildPointsSync(
    key: string,
    points: AttributionPoint[],
    pressureLevels: PressureLevel[],
  ): THREE.Data3DTexture {
    const { points: p, levels: l } = VolumeCache.serialize(points, pressureLevels)
    const data = buildVolumeData({ points: p, levels: l })
    const tex = dataToTexture(data, VOL_W, VOL_H, VOL_Z)
    return this.insert(key, tex, data.byteLength)
  }

  private buildGridsSync(
    key: string,
    grids: Record<string, DenseLevelGrid>,
    pressureLevels: PressureLevel[],
    options: NormalizedDenseBuildOptions,
  ): THREE.Data3DTexture {
    const levels = pressureLevels.map(l => ({
      id: l.id, visible: l.visible, opacity: l.opacity,
      baseAltitude: l.baseAltitude, topAltitude: l.topAltitude,
    }))
    const buildResult = buildVolumeDataFromGrids({
      grids,
      levels,
      diverging: options.diverging,
      smoothEnabled: options.smoothEnabled,
      smoothSigma: options.smoothSigma,
      absolute: options.absolute,
    })
    const filter = buildResult.useLinearFiltering ? THREE.LinearFilter : THREE.NearestFilter
    const tex = dataToTexture(buildResult.data, buildResult.width, buildResult.height, buildResult.depth, filter, filter)
    return this.insert(key, tex, buildResult.data.byteLength)
  }

  private buildPendingSync(key: string, build: PendingBuild): THREE.Data3DTexture {
    if (build.kind === 'grids') {
      return this.buildGridsSync(key, build.grids, build.pressureLevels, build.options)
    }
    return this.buildPointsSync(key, build.points, build.pressureLevels)
  }

  /**
   * Get a volume texture, building it asynchronously in a Worker if available,
   * or synchronously on the main thread as fallback.
   */
  getOrBuild(
    frameKey: string,
    points: AttributionPoint[],
    pressureLevels: PressureLevel[],
  ): THREE.Data3DTexture | Promise<THREE.Data3DTexture> {
    const key = VolumeCache.cacheKey(frameKey, pressureLevels)
    const cached = this.getCached(key)
    if (cached) return cached

    // No worker available → build on main thread
    if (!this.worker) {
      return this.buildPointsSync(key, points, pressureLevels)
    }

    // Already building this exact key?
    if (this.pending.has(key)) {
      return new Promise(resolve => {
        this.pending.get(key)!.resolvers.push(resolve)
      })
    }

    return new Promise(resolve => {
      this.pending.set(key, {
        kind: 'points',
        points,
        pressureLevels,
        resolvers: [resolve],
      })

      const { points: p, levels: l } = VolumeCache.serialize(points, pressureLevels)
      try {
        this.worker!.postMessage({ id: key, msgType: 'build', points: p, levels: l })
      } catch {
        this.pending.delete(key)
        this.worker?.terminate()
        this.worker = null
        resolve(this.buildPointsSync(key, points, pressureLevels))
      }
    })
  }

  /**
   * Build a volume texture from pre-computed dense 2D grids (one uint8 flat array per
   * pressure level). Cached hits return synchronously; misses build in the worker when
   * available so large imported bundles do not block the UI thread.
   */
  getOrBuildFromGrids(
    frameKey: string,
    grids: Record<string, DenseLevelGrid>,
    pressureLevels: PressureLevel[],
    options: DenseBuildOptions = {},
  ): THREE.Data3DTexture | Promise<THREE.Data3DTexture> {
    const normalizedOptions = VolumeCache.normalizeDenseBuildOptions(options)
    const smoothKey = normalizedOptions.smoothEnabled ? normalizedOptions.smoothSigma.toFixed(2) : 'off'
    const buildInfo = resolveDenseGridBuildInfo(grids, normalizedOptions.smoothEnabled)
    const filterKey = buildInfo.useLinearFiltering ? 'linear' : 'nearest'
    const key = `${VolumeCache.cacheKey(frameKey, pressureLevels)}__dense:flat:${normalizedOptions.diverging ? 'diverging' : 'sequential'}:abs:${normalizedOptions.absolute ? 'on' : 'off'}:xy:${smoothKey}:work:${buildInfo.width}x${buildInfo.height}:filter:${filterKey}`
    const cached = this.getCached(key)
    if (cached) return cached

    if (!this.worker) {
      return this.buildGridsSync(key, grids, pressureLevels, normalizedOptions)
    }

    if (this.pending.has(key)) {
      return new Promise(resolve => {
        this.pending.get(key)!.resolvers.push(resolve)
      })
    }

    return new Promise(resolve => {
      this.pending.set(key, {
        kind: 'grids',
        grids,
        pressureLevels,
        options: normalizedOptions,
        resolvers: [resolve],
      })

      const { levels } = VolumeCache.serialize([], pressureLevels)
      try {
        this.worker!.postMessage({
          id: key,
          msgType: 'buildFromGrids',
          grids,
          levels,
          diverging: normalizedOptions.diverging,
          smoothEnabled: normalizedOptions.smoothEnabled,
          smoothSigma: normalizedOptions.smoothSigma,
          absolute: normalizedOptions.absolute,
        })
      } catch {
        this.pending.delete(key)
        this.worker?.terminate()
        this.worker = null
        resolve(this.buildGridsSync(key, grids, pressureLevels, normalizedOptions))
      }
    })
  }

  /** Check if a texture is still held in the cache */
  hasTexture(tex: THREE.Data3DTexture): boolean {
    return this.entries.some(e => e.texture === tex)
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.entries) {
      entry.texture.dispose()
    }
    this.entries = []
    this.totalBytes = 0
    this.pending.clear()
  }
}
