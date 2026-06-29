import {
  VOL_W, VOL_H, VOL_Z,
  buildVolumeData, buildVolumeDataFromGrids,
  type BuildVolumeParams, type BuildVolumeFromGridsParams,
} from './volume'

type WorkerMessage =
  | (BuildVolumeParams & { id: string; msgType?: 'build' })
  | (BuildVolumeFromGridsParams & { id: string; msgType: 'buildFromGrids' })

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { id, msgType } = e.data
  let data: Uint8Array
  let width = VOL_W
  let height = VOL_H
  let depth = VOL_Z
  let useLinearFiltering = true
  if (msgType === 'buildFromGrids') {
    const {
      grids,
      levels,
      diverging,
      smoothEnabled,
      smoothSigma,
      absolute,
    } = e.data as BuildVolumeFromGridsParams & { id: string; msgType: 'buildFromGrids' }
    const result = buildVolumeDataFromGrids({
      grids,
      levels,
      diverging,
      smoothEnabled,
      smoothSigma,
      absolute,
    })
    data = result.data
    width = result.width
    height = result.height
    depth = result.depth
    useLinearFiltering = result.useLinearFiltering
  } else {
    const { points, levels } = e.data as BuildVolumeParams & { id: string }
    data = buildVolumeData({ points, levels })
  }
  // Transfer the buffer (zero-copy) back to main thread
  ;(self as unknown as Worker).postMessage({
    id,
    data,
    width,
    height,
    depth,
    useLinearFiltering,
  }, [data.buffer])
}
