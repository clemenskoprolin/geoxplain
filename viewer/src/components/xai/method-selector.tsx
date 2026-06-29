import { cn } from '@/lib/utils'

export interface MethodEntry {
  id: string
  label: string
  shortLabel: string
  description?: string
}

interface MethodSelectorProps {
  /** List of methods to display. */
  methods: MethodEntry[]
  selectedId: string
  onSelect: (id: string) => void
}

export function MethodSelector({ methods, selectedId, onSelect }: MethodSelectorProps) {
  if (methods.length === 0) return null

  if (methods.length === 1) {
    const method = methods.find((entry) => entry.id === selectedId) ?? methods[0]

    return (
      <div
        className="min-w-0 px-1 py-1 text-sm"
        title={method.description ?? method.label}
        aria-label={`Method: ${method.label}`}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 sm:inline">
            Method
          </span>
          <span className="min-w-0 truncate font-medium text-foreground/90">
            <span className="hidden sm:inline">{method.label}</span>
            <span className="sm:hidden">{method.shortLabel}</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg backdrop-blur-sm border border-border/50">
      {methods.map((method) => (
        <button
          key={method.id}
          onClick={() => onSelect(method.id)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
            'hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'touch-manipulation select-none',
            selectedId === method.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title={method.description}
        >
          <span className="hidden sm:inline">{method.label}</span>
          <span className="sm:hidden">{method.shortLabel}</span>
        </button>
      ))}
    </div>
  )
}
