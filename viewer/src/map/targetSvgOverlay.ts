import type maplibregl from 'maplibre-gl'
import { splitWrappedTargetBox } from '@/lib/targets'
import type { ViewerTarget } from '@/types'

/** Build an SVG path `d` tracing the projected target box (wrap-split into segments). */
export function makeBoxPathD(map: maplibregl.Map, target: Extract<ViewerTarget, { type: 'box' }>): string {
  return splitWrappedTargetBox(target).map(seg => {
    const sw = map.project([seg.lonMin, seg.latMin])
    const nw = map.project([seg.lonMin, seg.latMax])
    const ne = map.project([seg.lonMax, seg.latMax])
    const se = map.project([seg.lonMax, seg.latMin])
    return (
      `M${sw.x.toFixed(1)},${sw.y.toFixed(1)}` +
      ` L${nw.x.toFixed(1)},${nw.y.toFixed(1)}` +
      ` L${ne.x.toFixed(1)},${ne.y.toFixed(1)}` +
      ` L${se.x.toFixed(1)},${se.y.toFixed(1)} Z`
    )
  }).join(' ')
}

/** Re-project the target box/point and write geometry + style onto the SVG elements. */
export function refreshTargetSvg(
  map: maplibregl.Map,
  target: ViewerTarget | null,
  boxEl: SVGPathElement | null,
  pointEl: SVGCircleElement | null,
  color: string,
) {
  if (!boxEl || !pointEl) return

  if (!target) {
    boxEl.setAttribute('display', 'none')
    pointEl.setAttribute('display', 'none')
    return
  }

  if (target.type === 'box') {
    const d = makeBoxPathD(map, target)
    boxEl.setAttribute('d', d)
    boxEl.setAttribute('stroke', color)
    boxEl.setAttribute('stroke-width', '2')
    boxEl.setAttribute('fill', color)
    boxEl.setAttribute('fill-opacity', '0.18')
    boxEl.removeAttribute('display')
    pointEl.setAttribute('display', 'none')
  } else {
    const p = map.project([target.lon, target.lat])
    const cx = p.x.toFixed(1)
    const cy = p.y.toFixed(1)
    pointEl.setAttribute('cx', cx)
    pointEl.setAttribute('cy', cy)
    pointEl.setAttribute('r', '6')
    pointEl.setAttribute('fill', color)
    pointEl.setAttribute('stroke', '#f8fafc')
    pointEl.setAttribute('stroke-width', '1.5')
    pointEl.removeAttribute('display')
    boxEl.setAttribute('display', 'none')
  }
}
