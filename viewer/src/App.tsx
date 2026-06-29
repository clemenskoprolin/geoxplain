import { useMemo, useState, useEffect, useRef } from 'react'
import { fetchViewerDataSnapshot } from '@/data/dataLoader'
import type { DenseGridInput } from '@/types'
import { AttributionViewer } from '@/components/AttributionViewer'
import { parseLaunchStateFromSearch } from '@/lib/launchState'

const DEFAULT_VIEWER_DATA_URL = './viewer_data.json'
const VIEWER_DATA_POLL_INTERVAL_MS = 1500
const VIEWER_DATA_SYNC_URL = './__geoxplain_sync__'
const VIEWER_DATA_SYNC_EVENT = 'viewer-data'
const LIVE_SYNC_QUERY_PARAM = 'live'
const VIEWER_DATA_QUERY_PARAM = 'data'

function isLiveSyncEnabled(search: string): boolean {
  return new URLSearchParams(search).get(LIVE_SYNC_QUERY_PARAM) === '1'
}

/**
 * Resolve which viewer_data.json to load.
 *
 * Precedence: a ``?data=`` query override (an absolute path or full URL the
 * page can fetch) > the ``VITE_VIEWER_DATA_URL`` build-time env var > the
 * default ``./viewer_data.json`` served alongside the bundle. The override
 * lets the Vite dev server point at any served file without coupling it to
 * ``viewer/public``.
 */
function resolveViewerDataUrl(search: string): string {
  const override = new URLSearchParams(search).get(VIEWER_DATA_QUERY_PARAM)
  if (override && override.trim()) return override.trim()
  const envUrl = import.meta.env.VITE_VIEWER_DATA_URL
  if (typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim()
  return DEFAULT_VIEWER_DATA_URL
}

/**
 * Standalone browser-app root.
 *
 * Fetches viewer_data.json on mount and hands it to AttributionViewer.
 * Uses Python-pushed live updates when the launch URL opts into them,
 * otherwise polls as a fallback for static file hosting.
 */
export default function App() {
  const [externalData, setExternalData] = useState<DenseGridInput | null>(null)
  const lastContentHashRef = useRef<string | null>(null)
  const initialLaunchState = useMemo(
    () => parseLaunchStateFromSearch(window.location.search),
    [],
  )
  const liveSyncEnabled = useMemo(
    () => isLiveSyncEnabled(window.location.search),
    [],
  )
  const viewerDataUrl = useMemo(
    () => resolveViewerDataUrl(window.location.search),
    [],
  )

  useEffect(() => {
    let cancelled = false
    let timeoutId = 0
    let eventSource: EventSource | null = null

    const loadSnapshot = async () => {
      const snapshot = await fetchViewerDataSnapshot(viewerDataUrl)
      if (cancelled || !snapshot) return

      if (snapshot.contentHash !== lastContentHashRef.current) {
        lastContentHashRef.current = snapshot.contentHash
        setExternalData(snapshot.data)
      }
    }

    const schedulePoll = () => {
      timeoutId = window.setTimeout(async () => {
        await loadSnapshot()
        if (!cancelled) schedulePoll()
      }, VIEWER_DATA_POLL_INTERVAL_MS)
    }

    const handleViewerDataEvent = (event: Event) => {
      if (event instanceof MessageEvent && typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data) as { contentHash?: string }
          if (typeof payload.contentHash === 'string' && payload.contentHash === lastContentHashRef.current) {
            return
          }
        } catch {
          // Ignore malformed sync events and fetch the latest snapshot.
        }
      }
      void loadSnapshot()
    }

    void loadSnapshot()

    if (liveSyncEnabled && typeof EventSource !== 'undefined') {
      eventSource = new EventSource(VIEWER_DATA_SYNC_URL)
      eventSource.addEventListener(VIEWER_DATA_SYNC_EVENT, handleViewerDataEvent)
    } else {
      schedulePoll()
    }

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      if (eventSource) {
        eventSource.removeEventListener(VIEWER_DATA_SYNC_EVENT, handleViewerDataEvent)
        eventSource.close()
      }
    }
  }, [liveSyncEnabled, viewerDataUrl])

  return (
    <AttributionViewer
      externalData={externalData}
      height="100dvh"
      initialViewMode={externalData?.viewerOptions?.viewMode ?? 'map'}
      initialMapType={externalData?.viewerOptions?.mapType ?? 'topo'}
      initialSmoothImportedGrids={externalData?.viewerOptions?.smoothImportedGrids ?? true}
      initialZoomOutFactor={externalData?.viewerOptions?.zoomOutFactor ?? 1}
      appTitle={externalData?.appTitle}
      appSubtitle={externalData?.appSubtitle}
      initialLaunchState={initialLaunchState}
    />
  )
}
