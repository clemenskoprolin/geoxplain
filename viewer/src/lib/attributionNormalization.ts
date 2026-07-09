/**
 * Display-time normalization of attribution data.
 *
 * Payload v5+ encodes every level grid against its own max |raw value| and
 * ships that value as `maxAbs`. Any coarser normalization scope (per frame,
 * per method, all methods) therefore reduces to multiplying decoded samples by
 * `levelMaxAbs / targetMaxAbs` — a factor ≤ 1, so rescaling never clips and
 * matches what baking the coarse scope at export time would have produced.
 */

import type {
  AttributionNormalizationMode,
  DenseGridInput,
  DenseLevelGrid,
  DenseMethodFrame,
} from '@/types'

export interface NormalizationScales {
  /** Per-level multiplier (levelMaxAbs / targetMaxAbs), each ≤ 1. */
  scales: Record<string, number>
  /**
   * Raw-value magnitude the colormap end corresponds to, for legend labels.
   * Null for 'per-level', where each level has its own range.
   */
  targetMaxAbs: number | null
}

/** Frames are matched across methods by timestamp, falling back to index. */
function frameGroupKey(frame: DenseMethodFrame, index: number): string {
  return frame.timestamp ?? `#${index}`
}

function frameMaxAbs(frame: DenseMethodFrame): number {
  let max = 0
  for (const level of Object.values(frame.levels)) {
    if (typeof level.maxAbs === 'number' && level.maxAbs > max) max = level.maxAbs
  }
  return max
}

/**
 * Whether every level of every frame carries `maxAbs` — i.e. the payload
 * supports live normalization-scope switching. Older payloads (v4) do not;
 * they render at their baked normalization and the UI control is hidden.
 */
export function hasNormalizationInfo(data: DenseGridInput | null): boolean {
  if (!data) return false
  let sawLevel = false
  for (const method of Object.values(data.methods)) {
    for (const frame of method.frames) {
      for (const level of Object.values(frame.levels)) {
        sawLevel = true
        if (typeof level.maxAbs !== 'number' || !(level.maxAbs > 0)) return false
      }
    }
  }
  return sawLevel
}

/**
 * Per-level rescale factors for the selected method's frame under the given
 * normalization mode. Returns null when the payload lacks `maxAbs` metadata
 * or the method/frame does not exist.
 */
export function computeNormalizationScales(
  data: DenseGridInput,
  methodSlug: string,
  frameIndex: number,
  mode: AttributionNormalizationMode,
): NormalizationScales | null {
  const method = data.methods[methodSlug]
  if (!method) return null
  const frame = method.frames[frameIndex] ?? method.frames[0]
  if (!frame) return null

  let targetMax: number
  switch (mode) {
    case 'per-level': {
      const scales: Record<string, number> = {}
      for (const levelId of Object.keys(frame.levels)) scales[levelId] = 1
      return { scales, targetMaxAbs: null }
    }
    case 'per-frame':
      targetMax = frameMaxAbs(frame)
      break
    case 'global': {
      targetMax = 0
      for (const methodFrame of method.frames) {
        targetMax = Math.max(targetMax, frameMaxAbs(methodFrame))
      }
      break
    }
    case 'per-frame-all-methods': {
      const key = frameGroupKey(frame, method.frames.indexOf(frame))
      targetMax = 0
      for (const otherMethod of Object.values(data.methods)) {
        for (let i = 0; i < otherMethod.frames.length; i++) {
          if (frameGroupKey(otherMethod.frames[i], i) !== key) continue
          targetMax = Math.max(targetMax, frameMaxAbs(otherMethod.frames[i]))
        }
      }
      break
    }
    case 'all-methods': {
      targetMax = 0
      for (const otherMethod of Object.values(data.methods)) {
        for (const otherFrame of otherMethod.frames) {
          targetMax = Math.max(targetMax, frameMaxAbs(otherFrame))
        }
      }
      break
    }
  }

  if (!(targetMax > 0)) return null

  const scales: Record<string, number> = {}
  for (const [levelId, level] of Object.entries(frame.levels)) {
    scales[levelId] = levelScale(level, targetMax)
  }
  return { scales, targetMaxAbs: targetMax }
}

function levelScale(level: DenseLevelGrid, targetMax: number): number {
  if (typeof level.maxAbs !== 'number' || !(level.maxAbs > 0)) return 1
  return Math.min(1, level.maxAbs / targetMax)
}

/** Stable signature for cache keys; empty scales collapse to 'off'. */
export function normScalesSignature(scales: Record<string, number> | null | undefined): string {
  if (!scales) return 'off'
  const entries = Object.entries(scales)
    .filter(([, scale]) => scale !== 1)
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return 'off'
  return entries.map(([levelId, scale]) => `${levelId}=${scale.toFixed(5)}`).join(',')
}
