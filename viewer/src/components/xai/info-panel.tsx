import { useState } from 'react'
import { cn } from '@/lib/utils'
import { XAI_METHODS, type AttributionPoint } from '@/types'

interface InfoPanelProps {
  selectedMethod: string
  /** Human-readable label override — used when selectedMethod is an external slug */
  methodLabel?: string
  currentTimestamp: string
  points: AttributionPoint[]
}

export function InfoPanel({ selectedMethod, methodLabel, currentTimestamp, points }: InfoPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const methodInfo = XAI_METHODS.find((m) => m.id === selectedMethod)
  const displayLabel = methodLabel ?? methodInfo?.label ?? selectedMethod
  const displayDescription = methodInfo?.description
  const avgIntensity = points.length > 0 ? points.reduce((s, p) => s + p.intensity, 0) / points.length : 0
  const maxIntensity = points.length > 0 ? Math.max(...points.map((p) => p.intensity)) : 0

  return (
    <div className="bg-card/80 backdrop-blur-md rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors touch-manipulation"
      >
        <div className="flex items-center gap-2">
          <InfoIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Data Info</span>
        </div>
        <ChevronIcon
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/30 rounded-md p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Method</div>
              <div className="text-sm font-medium">{displayLabel}</div>
            </div>
            <div className="bg-secondary/30 rounded-md p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Data Points</div>
              <div className="text-sm font-medium font-mono">{points.length}</div>
            </div>
            <div className="bg-secondary/30 rounded-md p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Intensity</div>
              <div className="text-sm font-medium font-mono">{avgIntensity.toFixed(3)}</div>
            </div>
            <div className="bg-secondary/30 rounded-md p-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Max Intensity</div>
              <div className="text-sm font-medium font-mono">{maxIntensity.toFixed(3)}</div>
            </div>
          </div>
          {displayDescription && <div className="text-xs text-muted-foreground">{displayDescription}</div>}
          <div className="text-[10px] text-muted-foreground/60 font-mono">Timestamp: {currentTimestamp}</div>
        </div>
      </div>

      {!isExpanded && (
        <div className="px-4 pb-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span><span className="font-mono">{points.length}</span> pts</span>
          <span>avg: <span className="font-mono">{avgIntensity.toFixed(2)}</span></span>
        </div>
      )}
    </div>
  )
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}
