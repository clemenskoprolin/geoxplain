/* eslint-disable react-refresh/only-export-components --
   This is the anywidget mount entry; it deliberately exports mountWidget
   alongside its internal components. React Fast Refresh does not apply to a
   module loaded by anywidget rather than Vite's dev server. */
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AttributionViewer } from '@/components/AttributionViewer'
import { parseViewerPayload } from '@/data/dataLoader'
import { ThemeContext } from '@/theme-context'
import type { DenseGridInput } from '@/types'

interface WidgetOptions {
  viewMode?: 'globe' | 'map'
  mapType?: 'satellite' | 'topo'
  contours?: boolean
  absolute?: boolean
  smoothImportedGrids?: boolean
  appTitle?: string
  appSubtitle?: string
}

interface BrowserConfig {
  enabled?: boolean
  href?: string
  status?: string
}

export interface AnyWidgetModel {
  get(key: 'grids_payload'): Record<string, unknown>
  get(key: 'options'): WidgetOptions
  get(key: 'browser_config'): BrowserConfig
  get(key: 'height'): number
  send(content: unknown): void
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

function readJupyterConfigData(): Record<string, unknown> | null {
  const script = document.getElementById('jupyter-config-data')
  if (!script?.textContent) return null
  try {
    const parsed = JSON.parse(script.textContent)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '/'
  let normalizedValue = value
  try {
    normalizedValue = new URL(value, window.location.origin).pathname
  } catch {
    // Leave the raw string in place for path normalization below.
  }
  const trimmed = normalizedValue.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

function normalizeRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  return trimmed || undefined
}

function stripBaseUrl(pathname: string, baseUrl: string): string {
  const normalizedPath = pathname.startsWith(baseUrl) ? pathname.slice(baseUrl.length) : pathname
  return normalizedPath.replace(/^\/+/, '')
}

function deriveNotebookPath(pagePath: string, config: Record<string, unknown> | null): string | undefined {
  const direct = [
    config?.notebookPath,
    config?.notebook_path,
    config?.treePath,
    config?.tree_path,
    config?.filePath,
    config?.file_path,
  ]
    .map(normalizeRelativePath)
    .find((value): value is string => !!value)
  if (direct) return direct

  const patterns = [
    /^(?:lab(?:\/workspaces\/[^/]+)?\/tree)\/(.+)$/,
    /^lab\/notebooks\/(.+)$/,
    /^notebooks\/(.+)$/,
    /^tree\/(.+)$/,
  ]
  for (const pattern of patterns) {
    const match = pagePath.match(pattern)
    if (match?.[1]) {
      return normalizeRelativePath(match[1])
    }
  }
  return undefined
}

function collectPageContext() {
  const config = readJupyterConfigData()
  const baseUrl = normalizeBaseUrl(
    config?.baseUrl
      ?? config?.base_url
      ?? document.body?.dataset?.baseUrl
      ?? window.location.origin,
  )
  const pagePath = normalizeRelativePath(
    (typeof config?.pageUrl === 'string' && config.pageUrl)
      || (typeof config?.page_url === 'string' && config.page_url)
      || stripBaseUrl(window.location.pathname, baseUrl),
  )

  return {
    kind: 'geoxplain:jupyter_page_context',
    origin: window.location.origin,
    baseUrl,
    pagePath,
    notebookPath: deriveNotebookPath(pagePath ?? '', config),
  }
}

interface ErrorBoundaryState { error: Error | null }

class WidgetErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '16px',
          fontFamily: 'monospace',
          fontSize: '12px',
          background: '#fff3f3',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          color: '#991b1b',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: '300px',
          overflow: 'auto',
        }}>
          <strong>GeoXplain Widget - render error</strong>{'\n\n'}
          {this.state.error.message}{'\n\n'}
          {this.state.error.stack}
        </div>
      )
    }
    return this.props.children
  }
}

function WidgetApp({ model }: { model: AnyWidgetModel }) {
  const [externalData, setExternalData] = useState<DenseGridInput | null>(() =>
    parseViewerPayload(model.get('grids_payload')),
  )
  const [browserConfig, setBrowserConfig] = useState<BrowserConfig>(() => model.get('browser_config'))
  const [opts, setOpts] = useState<WidgetOptions>(() => model.get('options'))

  useEffect(() => {
    function onPayloadChange() {
      setExternalData(parseViewerPayload(model.get('grids_payload')))
    }
    model.on('change:grids_payload', onPayloadChange)
    return () => model.off('change:grids_payload', onPayloadChange)
  }, [model])

  useEffect(() => {
    function onBrowserConfigChange() {
      setBrowserConfig(model.get('browser_config'))
    }
    model.on('change:browser_config', onBrowserConfigChange)
    return () => model.off('change:browser_config', onBrowserConfigChange)
  }, [model])

  useEffect(() => {
    function onOptionsChange() {
      setOpts(model.get('options'))
    }
    model.on('change:options', onOptionsChange)
    return () => model.off('change:options', onOptionsChange)
  }, [model])

  useEffect(() => {
    model.send(collectPageContext())
  }, [model])

  return (
    <AttributionViewer
      externalData={externalData}
      height="100%"
      initialViewMode={opts.viewMode ?? 'map'}
      initialMapType={opts.mapType ?? 'topo'}
      initialContours={opts.contours ?? false}
      initialAbsolute={opts.absolute ?? false}
      initialSmoothImportedGrids={opts.smoothImportedGrids ?? true}
      appTitle={typeof opts.appTitle === 'string' ? opts.appTitle : externalData?.appTitle}
      appSubtitle={typeof opts.appSubtitle === 'string' ? opts.appSubtitle : externalData?.appSubtitle}
      browserLaunchHref={browserConfig.enabled && browserConfig.href ? browserConfig.href : undefined}
      onScreenshotStateChange={(snapshot) => {
        model.send({
          kind: 'geoxplain:viewer_state',
          ...snapshot,
        })
      }}
    />
  )
}

function WidgetShell({ model, scopedRoot }: { model: AnyWidgetModel; scopedRoot: HTMLElement }) {
  return (
    <ThemeContext.Provider value={{ scopedRoot }}>
      <div className="w-full h-full bg-background text-foreground m-0">
        <div className="bg-background text-foreground" style={{ width: '95%', margin: '0 auto', height: '100%' }}>
          <WidgetApp model={model} />
        </div>
      </div>
    </ThemeContext.Provider>
  )
}

export function mountWidget({ model, el }: { model: AnyWidgetModel; el: HTMLElement }) {
  const root = createRoot(el)
  root.render(
    <StrictMode>
      <WidgetErrorBoundary>
        <WidgetShell model={model} scopedRoot={el} />
      </WidgetErrorBoundary>
    </StrictMode>,
  )

  return () => root.unmount()
}
