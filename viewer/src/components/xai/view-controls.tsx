import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { GlobeMapType } from '@/types'

const MAP_LABELS: Record<GlobeMapType, string> = {
  satellite: 'Satellite',
  topo: 'Topo',
}

const MAP_NEXT_LABEL: Record<GlobeMapType, string> = {
  satellite: 'Switch to topographic',
  topo: 'Switch to satellite',
}

interface ViewControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  resetDisabled?: boolean
  zoom: number
  mapType: GlobeMapType
  onMapTypeToggle: () => void
  viewMode: 'globe' | 'map'
  onViewModeToggle: () => void
}

export function ViewControls({ onZoomIn, onZoomOut, onReset, resetDisabled = false, zoom, mapType, onMapTypeToggle, viewMode, onViewModeToggle }: ViewControlsProps) {
  const zoomPercent = Math.round(zoom * 100)
  const compactZoomLabel = Math.abs(zoomPercent) >= 10000

  return (
    <div className="flex flex-col gap-1 bg-card/80 backdrop-blur-md rounded-lg border border-border/50 p-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onZoomIn}
        className="touch-manipulation"
        aria-label="Zoom in"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>

      <div className={cn(
        'w-7 whitespace-nowrap text-center text-muted-foreground font-mono py-1',
        compactZoomLabel ? 'text-[8px]' : 'text-[10px]',
      )}>
        {zoomPercent}%
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onZoomOut}
        className="touch-manipulation"
        aria-label="Zoom out"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>

      <div className="h-px bg-border my-0.5" />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onReset}
        disabled={resetDisabled}
        className="touch-manipulation"
        aria-label="Reset view"
      >
        <ResetIcon className="h-4 w-4" />
      </Button>

      <div className="h-px bg-border my-0.5" />

      {/* Satellite / Topo toggle */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onMapTypeToggle}
        className={cn('touch-manipulation', mapType === 'satellite' && 'text-primary bg-primary/10')}
        aria-label={MAP_NEXT_LABEL[mapType]}
        title={`${MAP_LABELS[mapType]} — ${MAP_NEXT_LABEL[mapType]}`}
      >
        {mapType === 'satellite' ? (
          <TopoIcon className="h-4 w-4" />
        ) : (
          <SatelliteIcon className="h-4 w-4" />
        )}
      </Button>

      <div className="h-px bg-border my-0.5" />

      {/* Globe / flat-map toggle */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onViewModeToggle}
        className={cn('touch-manipulation', viewMode === 'globe' && 'text-primary bg-primary/10')}
        aria-label={viewMode === 'globe' ? 'Switch to flat map' : 'Switch to globe'}
        title={viewMode === 'globe' ? 'Switch to flat map' : 'Switch to globe'}
      >
        {viewMode === 'globe' ? (
          <FlatMapIcon className="h-4 w-4" />
        ) : (
          <GlobeIcon className="h-4 w-4" />
        )}
      </Button>

    </div>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
    </svg>
  )
}

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function TopoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      {/* folded map outline: three panels */}
      <path strokeLinejoin="round" d="M9 4 L3 6.5 V20 L9 17.5 L15 20 L21 17.5 V4 L15 6.5 L9 4 Z" />
      {/* fold creases */}
      <line x1="9" y1="4" x2="9" y2="17.5" strokeLinecap="round" />
      <line x1="15" y1="6.5" x2="15" y2="20" strokeLinecap="round" />
    </svg>
  )
}

function SatelliteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      {/* body */}
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="0.75" strokeLinejoin="round" />
      {/* left arm + panel */}
      <line x1="9.75" y1="12" x2="7.5" y2="12" strokeLinecap="round" />
      <rect x="2.5" y="10" width="5" height="4" rx="0.5" strokeLinejoin="round" />
      <line x1="4.17" y1="10" x2="4.17" y2="14" />
      <line x1="5.83" y1="10" x2="5.83" y2="14" />
      {/* right arm + panel */}
      <line x1="14.25" y1="12" x2="16.5" y2="12" strokeLinecap="round" />
      <rect x="16.5" y="10" width="5" height="4" rx="0.5" strokeLinejoin="round" />
      <line x1="18.17" y1="10" x2="18.17" y2="14" />
      <line x1="19.83" y1="10" x2="19.83" y2="14" />
      {/* signal arcs */}
      <path strokeLinecap="round" d="M15.5 8.75 Q17.75 6.5 17.75 6.5" />
      <path strokeLinecap="round" d="M16.75 7.5 Q19.5 4.75 19.5 4.75" />
      <path strokeLinecap="round" d="M8.5 8.75 Q6.25 6.5 6.25 6.5" />
      <path strokeLinecap="round" d="M7.25 7.5 Q4.5 4.75 4.5 4.75" />
    </svg>
  )
}

// Flat map icon — rectangle with crosshair grid, clearly a 2D projected map
function FlatMapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
      <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
    </svg>
  )
}

// Globe icon — sphere with equator and meridian, shown when in flat-map mode to switch back to globe
function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4.5" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
    </svg>
  )
}

