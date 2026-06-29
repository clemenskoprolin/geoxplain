import { CameraIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ViewerActionBarProps {
  browserLaunchHref?: string
  onOpenInBrowser: () => void
  onDownloadScreenshot: () => void
  downloadDisabled: boolean
}

/** Bottom-right pill: optional "Open in Browser" link + screenshot download. */
export function ViewerActionBar({
  browserLaunchHref,
  onOpenInBrowser,
  onDownloadScreenshot,
  downloadDisabled,
}: ViewerActionBarProps) {
  return (
    <div
      className="absolute right-4 bottom-4 z-10"
      data-geoxplain-screenshot-exclude
    >
      <div className="flex h-8 items-center overflow-hidden rounded-full border border-border/60 bg-card/85 shadow-sm backdrop-blur-sm">
        {browserLaunchHref && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenInBrowser}
              className="h-8 rounded-none border-0 px-3 hover:bg-muted/70"
            >
              Open in Browser
            </Button>
            <div className="h-4 w-px bg-border/70" aria-hidden="true" />
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDownloadScreenshot}
          disabled={downloadDisabled}
          className="h-8 w-8 rounded-none border-0 hover:bg-muted/70"
          aria-label="Download screenshot"
          title="Download screenshot"
        >
          <CameraIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
