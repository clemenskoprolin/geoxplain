import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlobeIcon } from '@/components/attributionViewer/GlobeIcon'

/** Centered overlay shown when no attribution data has been imported yet. */
export function NoDataHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center px-4 pointer-events-none"
      data-geoxplain-screenshot-exclude
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-lg border border-border/70 bg-card/95 px-6 py-5 text-center shadow-xl backdrop-blur-md pointer-events-auto">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss no-data hint"
        >
          <XIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
          <GlobeIcon className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">No data imported yet</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          import that with{' '}
          <code className="rounded bg-secondary/70 px-1.5 py-0.5 font-mono text-xs text-foreground">
            GeoXplain.add_attribution()
          </code>{' '}
          or initialize with{' '}
          <code className="rounded bg-secondary/70 px-1.5 py-0.5 font-mono text-xs text-foreground">
            GeoXplainWidget(result=data)
          </code>
        </p>
      </div>
    </div>
  )
}
