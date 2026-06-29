import * as THREE from 'three'
import type { DenseLevelGrid } from '@/types'

/** Create an empty 1×1×1 Data3DTexture (black) as placeholder */
export function emptyVolume(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

export function hasDenseGridData(
  grids: Record<string, DenseLevelGrid> | null | undefined,
): grids is Record<string, DenseLevelGrid> {
  return !!grids && Object.keys(grids).length > 0
}
