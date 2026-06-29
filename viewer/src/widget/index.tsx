/**
 * anywidget frontend entrypoint for the GeoXplain viewer.
 *
 * anywidget calls the exported `render({ model, el })` function once per
 * widget instance.  Keep this file light: it should reach `render()` even if
 * the heavier viewer bundle later fails during import, so we can surface a
 * visible in-cell error instead of a silent blank output.
 *
 * Trait layout (mirrors geoxplain/widget.py):
 *   grids_payload  – heavy: base64-encoded dense grids (viewer_data.json format)
 *   options        - light: { viewMode, mapType, contours }
 *   browser_config – light: { enabled, href, status }
 *   height         – number (px), default 620
 */

import './widget.css'

interface AnyWidgetModel {
  get(key: 'height'): number
}

interface BrowserProcessLike {
  env?: {
    NODE_ENV?: string
  }
  emit?: (...args: unknown[]) => void
}

const DARK_FRAME_BACKGROUND = 'oklch(0.12 0.01 260)'
const LIGHT_FRAME_BACKGROUND = 'oklch(0.98 0.005 260)'
const WIDGET_HOST_CLASS = 'geoxplain-widget-host'

function composedParent(node: HTMLElement): HTMLElement | null {
  if (node.parentElement) return node.parentElement

  const root = node.getRootNode()
  return root instanceof ShadowRoot && root.host instanceof HTMLElement
    ? root.host
    : null
}

function prepareHostFrame(el: HTMLElement, height: number) {
  const properties = [
    'background',
    'background-color',
    'border-color',
    'box-sizing',
    'display',
    'height',
    'margin',
    'margin-left',
    'margin-right',
    'margin-top',
    'margin-bottom',
    'max-height',
    'min-width',
    'outline-color',
    'overflow',
    'position',
    'width',
  ]
  const touched: Array<{
    node: HTMLElement
    values: Record<string, { value: string; priority: string }>
  }> = []

  const hadHostClass = el.classList.contains(WIDGET_HOST_CLASS)
  el.classList.add(WIDGET_HOST_CLASS)

  let ancestor: HTMLElement | null = el
  for (let depth = 0; depth < 22 && ancestor; depth += 1) {
    const node: HTMLElement = ancestor
    const isDocumentFrame = node === node.ownerDocument.body || node === node.ownerDocument.documentElement
    touched.push({
      node,
      values: Object.fromEntries(properties.map((property) => [
        property,
        {
          value: node.style.getPropertyValue(property),
          priority: node.style.getPropertyPriority(property),
        },
      ])),
    })

    const style = node.style
    if (!isDocumentFrame) {
      if (depth === 0) {
        style.width = 'calc(100% + 16px)'
        style.marginLeft = '-8px'
        style.marginRight = '-8px'
      } else if (!style.width) {
        style.width = '100%'
      }
      if (!style.minWidth) style.minWidth = depth === 0 ? '320px' : '0'
      if (!style.display) style.display = 'block'
      if (!style.height || parseFloat(style.height) < height) style.height = `${height}px`
      if (style.maxHeight && parseFloat(style.maxHeight) < height) style.maxHeight = `${height}px`
      if (depth === 0) {
        style.marginTop = '0'
        style.marginBottom = '0'
        style.boxSizing = 'border-box'
        style.position = 'relative'
      }
      style.overflow = depth === 0 ? 'hidden' : 'visible'
    }
    ancestor = composedParent(node)
  }

  function syncBackground() {
    const background = el.classList.contains('dark')
      ? DARK_FRAME_BACKGROUND
      : LIGHT_FRAME_BACKGROUND
    for (const { node } of touched) {
      node.style.setProperty('background', background, 'important')
      node.style.setProperty('background-color', background, 'important')
      node.style.setProperty('border-color', background, 'important')
      node.style.setProperty('outline-color', background, 'important')
    }
  }

  syncBackground()
  const observer = new MutationObserver(syncBackground)
  observer.observe(el, { attributes: true, attributeFilter: ['class'] })

  return () => {
    observer.disconnect()
    for (const { node, values } of touched) {
      for (const [property, { value, priority }] of Object.entries(values)) {
        node.style.setProperty(property, value, priority)
      }
    }
    if (!hadHostClass) {
      el.classList.remove(WIDGET_HOST_CLASS)
    }
  }
}

// ── anywidget render export ───────────────────────────────────────────────────

export async function render({ model, el }: { model: AnyWidgetModel; el: HTMLElement }) {
  const height = model.get('height') || 620
  let clearInitDiagnostics = () => {}
  let cleanupHostFrame = () => {}

  // Some bundled dependencies still read `process.env.NODE_ENV` at module
  // evaluation time. VSCode's notebook webview does not expose Node's
  // `process`, so provide the minimal browser-side shim before importing the
  // heavier widget runtime.
  const browserProcess = (globalThis as typeof globalThis & { process?: BrowserProcessLike }).process
  if (!browserProcess) {
    ;(globalThis as typeof globalThis & { process?: BrowserProcessLike }).process = {
      env: { NODE_ENV: 'production' },
    }
  } else if (!browserProcess.env) {
    browserProcess.env = { NODE_ENV: 'production' }
  } else if (!browserProcess.env.NODE_ENV) {
    browserProcess.env.NODE_ENV = 'production'
  }

  function renderFallback(title: string, detail: string) {
    el.innerHTML = `
      <div style="
        box-sizing:border-box;
        min-width:320px;
        height:${height}px;
        padding:16px;
        border:1px solid #fca5a5;
        border-radius:8px;
        background:#fff3f3;
        color:#991b1b;
        font:12px ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space:pre-wrap;
        overflow:auto;
      ">
        <strong>${title}</strong>\n\n${detail}
      </div>
    `
  }

  renderFallback('GeoXplain Widget - loading', 'Initializing viewer...')

  cleanupHostFrame = prepareHostFrame(el, height)

  try {
    const onError = (event: ErrorEvent) => {
      renderFallback(
        'GeoXplain Widget - frontend error',
        String(event.error?.stack ?? event.error?.message ?? event.message ?? 'Unknown error'),
      )
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? (event.reason.stack ?? event.reason.message) : String(event.reason)
      renderFallback('GeoXplain Widget - unhandled rejection', reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    clearInitDiagnostics = () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    window.setTimeout(clearInitDiagnostics, 3000)

    const { mountWidget } = await import('./runtime')
    const cleanup = mountWidget({ model: model as import('./runtime').AnyWidgetModel, el })

    // anywidget calls the returned cleanup function on unmount.
    return () => {
      clearInitDiagnostics()
      cleanupHostFrame()
      cleanup()
    }
  } catch (error) {
    clearInitDiagnostics()
    cleanupHostFrame()
    const err = error instanceof Error ? (error.stack ?? error.message) : String(error)
    renderFallback('GeoXplain Widget - mount error', err)
    throw error
  }
}
