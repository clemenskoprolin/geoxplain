import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import type { TimestampData } from '@/types'

interface TimelineControlProps {
  timestamps: TimestampData[]
  currentIndex: number
  onIndexChange: (index: number) => void
  isPlaying: boolean
  onPlayPause: () => void
  playbackSpeed: number
  onSpeedChange: (speed: number) => void
}

const DATE_TIME_LABEL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/

function getTimelineDateParts(timestamp: TimestampData | undefined) {
  if (!timestamp) return null

  const labelMatch = timestamp.label.match(DATE_TIME_LABEL_RE)
  if (labelMatch) {
    const [, year, month, day, time] = labelMatch
    return {
      year,
      date: `${year}-${month}-${day}`,
      dateWithoutYear: `${month}-${day}`,
      time,
    }
  }

  const epochMs = timestamp.timestamp.getTime()
  if (Number.isNaN(epochMs)) return null

  const iso = timestamp.timestamp.toISOString()
  return {
    year: iso.slice(0, 4),
    date: iso.slice(0, 10),
    dateWithoutYear: iso.slice(5, 10),
    time: iso.slice(11, 16),
  }
}

function getTimelineDayKey(timestamp: TimestampData | undefined) {
  return getTimelineDateParts(timestamp)?.date ?? null
}

function spansMultipleDays(timestamps: TimestampData[]) {
  let firstDay: string | null = null

  for (const timestamp of timestamps) {
    const day = getTimelineDayKey(timestamp)
    if (!day) continue
    if (!firstDay) {
      firstDay = day
    } else if (day !== firstDay) {
      return true
    }
  }

  return false
}

function spansMultipleYears(timestamps: TimestampData[]) {
  let firstYear: string | null = null

  for (const timestamp of timestamps) {
    const year = getTimelineDateParts(timestamp)?.year ?? null
    if (!year) continue
    if (!firstYear) {
      firstYear = year
    } else if (year !== firstYear) {
      return true
    }
  }

  return false
}

function formatTimelineMarker(timestamp: TimestampData | undefined, showDate: boolean, showYear: boolean) {
  if (!timestamp) return ''

  const parts = getTimelineDateParts(timestamp)
  if (!parts) return timestamp.label
  if (!showDate) return parts.time

  return `${showYear ? parts.date : parts.dateWithoutYear} ${parts.time}`
}

export function TimelineControl({
  timestamps,
  currentIndex,
  onIndexChange,
  isPlaying,
  onPlayPause,
  playbackSpeed,
  onSpeedChange,
}: TimelineControlProps) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const multiStep = timestamps.length > 1
  const showMarkerDates = multiStep && spansMultipleDays(timestamps)
  const showMarkerYears = showMarkerDates && spansMultipleYears(timestamps)

  useEffect(() => {
    if (isPlaying && multiStep) {
      intervalRef.current = setInterval(() => {
        onIndexChange((currentIndex + 1) % timestamps.length)
      }, 1000 / playbackSpeed)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, currentIndex, timestamps.length, playbackSpeed, onIndexChange, multiStep])

  const handleSliderChange = useCallback(
    (value: number | readonly number[]) => {
      onIndexChange(Array.isArray(value) ? value[0] : value)
    },
    [onIndexChange]
  )

  const currentTimestamp = timestamps[currentIndex] ?? timestamps[0]

  return (
    <div className="w-full bg-card/80 backdrop-blur-md border-t border-border/50 px-4 py-3 safe-area-inset-bottom">
      <div className="max-w-4xl mx-auto flex flex-col gap-2">

        {/* Row 1: play + label + speed */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Play button: only useful for multi-step timelines */}
            {multiStep && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPlayPause}
                className="h-9 w-9 touch-manipulation"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
              </Button>
            )}

            <div className="flex flex-col">
              <span className="text-sm font-mono leading-tight">
                {currentTimestamp?.label || '--'}
              </span>
            </div>
          </div>

          {/* Speed controls: only for multi-step */}
          {multiStep && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">Speed:</span>
              <div className="flex items-center gap-1">
                {[0.5, 1, 2, 4].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => onSpeedChange(speed)}
                    className={cn(
                      'px-2 py-1 text-xs rounded transition-colors touch-manipulation',
                      playbackSpeed === speed
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                    )}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Row 2 + 3: slider and markers — only for multi-step timelines */}
        {multiStep && (
          <>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="shrink-0 touch-manipulation"
                aria-label="Previous timestamp"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>

              <div className="flex-1 px-1">
                <Slider
                  value={[currentIndex]}
                  min={0}
                  max={timestamps.length - 1}
                  step={1}
                  onValueChange={handleSliderChange}
                  className="touch-manipulation"
                />
              </div>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onIndexChange(Math.min(timestamps.length - 1, currentIndex + 1))}
                disabled={currentIndex === timestamps.length - 1}
                className="shrink-0 touch-manipulation"
                aria-label="Next timestamp"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>

            {/* Bottom row: time markers */}
            <div className="flex justify-between gap-2 px-10 text-[10px] font-mono tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap">{formatTimelineMarker(timestamps[0], showMarkerDates, showMarkerYears)}</span>
              <span className="hidden whitespace-nowrap sm:inline">
                {formatTimelineMarker(timestamps[Math.floor(timestamps.length / 2)], showMarkerDates, showMarkerYears)}
              </span>
              <span className="whitespace-nowrap">{formatTimelineMarker(timestamps[timestamps.length - 1], showMarkerDates, showMarkerYears)}</span>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  )
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}
