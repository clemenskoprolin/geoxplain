import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { splitWrappedTargetBox } from '@/lib/targets'
import type { ViewerTarget } from '@/types'
import { GLOBE_RADIUS } from './constants'

function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - lat)
  const theta = THREE.MathUtils.degToRad(90 - lon)
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

const TARGET_BOX_OUTLINE_PX = 2

type WideLineMaterial = LineMaterial & { linewidth: number }

function isTargetLineObject(obj: THREE.Object3D): obj is THREE.Line | Line2 {
  return obj instanceof THREE.Line || obj instanceof Line2
}

export function disposeTargetGroup(group: THREE.Group | null) {
  if (!group) return
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse((obj) => {
      if (isTargetLineObject(obj)) {
        obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.forEach((material) => material.dispose())
      } else if (obj instanceof THREE.Sprite) {
        // Dispose the material but not the shared marker texture.
        obj.material.dispose()
      }
    })
  }
}

export function setTargetGroupColor(group: THREE.Group | null, color: string) {
  if (!group) return
  group.traverse((obj) => {
    if (obj instanceof THREE.Sprite) {
      if (obj.userData.tintable) obj.material.color.set(color)
      return
    }
    if (!isTargetLineObject(obj)) return
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    materials.forEach((material) => {
      if (material instanceof THREE.LineBasicMaterial) {
        material.color.set(color)
      } else if (material instanceof LineMaterial) {
        material.color.set(color)
      }
    })
  })
}

export function setTargetGroupOpacity(group: THREE.Group | null, opacity: number) {
  if (!group) return
  group.traverse((obj) => {
    if (obj instanceof THREE.Sprite) {
      obj.material.opacity = opacity
      obj.visible = opacity > 0
      return
    }
    if (!isTargetLineObject(obj)) return
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    materials.forEach((material) => {
      if (material instanceof THREE.LineBasicMaterial) {
        material.opacity = opacity
      } else if (material instanceof LineMaterial) {
        material.opacity = opacity
      }
    })
    obj.visible = opacity > 0
  })
}

function makeWideGlobePolyline(
  coordinates: Array<readonly [number, number]>,
  radius: number,
  material: WideLineMaterial,
): Line2 {
  const positions: number[] = []
  const closedCoordinates = [...coordinates, coordinates[0]]
  for (const [lon, lat] of closedCoordinates) {
    const p = latLonToVector3(lat, lon, radius)
    positions.push(p.x, p.y, p.z)
  }
  const geometry = new LineGeometry()
  geometry.setPositions(positions)
  return new Line2(geometry, material)
}

// Pixel diameters of the point marker, matching the MapView SVG circle
// (r=6 fill + 1.5 white stroke). Kept screen-constant via updateTargetMarkerScale.
export const POINT_MARKER_FILL_PX = 16
const POINT_MARKER_RING_PX = 20

// Soft white disc texture, shared by every point marker and tinted per-sprite.
let sharedMarkerTexture: THREE.Texture | null = null
function getMarkerTexture(): THREE.Texture {
  if (sharedMarkerTexture) return sharedMarkerTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  // Opaque core with a 2px-equivalent antialiased edge so the disc reads as a
  // crisp dot rather than a blurry blob.
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.88, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(c, c, c, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  sharedMarkerTexture = tex
  return tex
}

function makeMarkerSprite(position: THREE.Vector3, pixelSize: number, color: string, tintable: boolean): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getMarkerTexture(),
    color,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
  }))
  sprite.position.copy(position)
  sprite.userData.pixelSize = pixelSize
  sprite.userData.tintable = tintable
  sprite.frustumCulled = false
  return sprite
}

function sampleRange(start: number, end: number, steps: number): number[] {
  if (steps <= 1) return [start]
  return Array.from({ length: steps }, (_, index) => start + ((end - start) * index) / (steps - 1))
}

function buildBoxLoops(target: Extract<ViewerTarget, { type: 'box' }>): Array<Array<readonly [number, number]>> {
  return splitWrappedTargetBox(target).map((segment) => {
    const latSpan = Math.abs(segment.latMax - segment.latMin)
    const lonSpan = Math.abs(segment.lonMax - segment.lonMin)
    const latSteps = Math.max(2, Math.ceil(latSpan / 5))
    const lonSteps = Math.max(2, Math.ceil(lonSpan / 5))
    const westEdge = sampleRange(segment.latMin, segment.latMax, latSteps).map((lat) => [segment.lonMin, lat] as const)
    const northEdge = sampleRange(segment.lonMin, segment.lonMax, lonSteps).map((lon) => [lon, segment.latMax] as const)
    const eastEdge = sampleRange(segment.latMax, segment.latMin, latSteps).map((lat) => [segment.lonMax, lat] as const)
    const southEdge = sampleRange(segment.lonMax, segment.lonMin, lonSteps).map((lon) => [lon, segment.latMin] as const)
    return [...westEdge, ...northEdge.slice(1), ...eastEdge.slice(1), ...southEdge.slice(1)]
  })
}

export function buildTargetGroup(target: ViewerTarget | null, color: string): THREE.Group {
  const group = new THREE.Group()
  group.renderOrder = 1001
  if (!target) return group

  const radius = GLOBE_RADIUS * 1.001

  if (target.type === 'point') {
    const position = latLonToVector3(target.lat, target.lon, radius)
    // White ring behind a colored core: a small, crisp pin matching MapView.
    const ring = makeMarkerSprite(position, POINT_MARKER_RING_PX, '#f8fafc', false)
    ring.renderOrder = 1001
    const core = makeMarkerSprite(position, POINT_MARKER_FILL_PX, color, true)
    core.renderOrder = 1002
    group.add(ring)
    group.add(core)
    return group
  }

  const material = new LineMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    worldUnits: false,
  }) as WideLineMaterial
  material.linewidth = TARGET_BOX_OUTLINE_PX

  for (const loopCoords of buildBoxLoops(target)) {
    const loop = makeWideGlobePolyline(loopCoords, radius, material.clone() as WideLineMaterial)
    loop.frustumCulled = false
    loop.renderOrder = 1001
    group.add(loop)
  }
  material.dispose()
  return group
}
