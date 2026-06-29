/** Small centered label shown on narrow screens to identify the active method. */
export function MobileMethodLabel({ label }: { label: string }) {
  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-10 sm:hidden"
      data-geoxplain-screenshot-exclude
    >
      <div className="bg-card/80 backdrop-blur-sm text-xs text-muted-foreground px-3 py-1.5 rounded-full border border-border/50">
        {label}
      </div>
    </div>
  )
}
