import type { GlobeMapType, ViewerMode } from '@/types'

const ATTRIBUTION_TEXT: Record<GlobeMapType, string> = {
  satellite: 'Imagery: Esri, Vantor, Earthstar Geographics, GIS User Community',
  topo: 'Basemap: CARTO | OpenStreetMap contributors',
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load screenshot overlay'))
    image.src = src
  })
}

function getActiveLayer(surface: HTMLElement, viewMode: ViewerMode): HTMLElement | null {
  return surface.querySelector<HTMLElement>(
    `[data-geoxplain-renderer-layer="${viewMode}"][data-geoxplain-active="true"]`,
  )
}

function getActiveCanvas(surface: HTMLElement, viewMode: ViewerMode): HTMLCanvasElement | null {
  return getActiveLayer(surface, viewMode)?.querySelector('canvas') ?? null
}

async function drawSvgOverlay(
  context: CanvasRenderingContext2D,
  surface: HTMLElement,
  viewMode: ViewerMode,
  width: number,
  height: number,
) {
  const svg = getActiveLayer(surface, viewMode)?.querySelector('svg')
  if (!svg) return

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const serialized = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(url)
    context.drawImage(image, 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawAttribution(context: CanvasRenderingContext2D, mapType: GlobeMapType, width: number, height: number) {
  context.save()
  context.font = '9px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  if (mapType === 'satellite') {
    context.fillStyle = 'rgba(255,255,255,0.72)'
    context.shadowColor = 'rgba(0,0,0,0.45)'
    context.shadowBlur = 2
    context.shadowOffsetY = 1
  } else {
    context.fillStyle = 'rgba(95,99,112,0.58)'
  }
  context.fillText(ATTRIBUTION_TEXT[mapType], width / 2, height - 6)
  context.restore()
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('The browser could not create a PNG screenshot.'))
        }
      }, 'image/png')
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function timestampFilename() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `geoxplain-screenshot-${stamp}.png`
}

export async function downloadViewerScreenshot({
  surface,
  viewMode,
  mapType,
}: {
  surface: HTMLElement
  viewMode: ViewerMode
  mapType: GlobeMapType
}) {
  await nextPaint()

  const rect = surface.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const source = getActiveCanvas(surface, viewMode)
  if (!source) {
    throw new Error('The viewer is still loading. Try the screenshot again in a moment.')
  }

  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) {
    throw new Error('The browser could not create a screenshot canvas.')
  }

  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height)
  await drawSvgOverlay(context, surface, viewMode, width, height)
  drawAttribution(context, mapType, width, height)

  const blob = await canvasToBlob(output)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = timestampFilename()
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
