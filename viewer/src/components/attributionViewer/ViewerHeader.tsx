import { MethodSelector, type MethodEntry } from '@/components/xai/method-selector'
import { ThemeToggle } from '@/components/xai/theme-toggle'
import { GlobeIcon } from '@/components/attributionViewer/GlobeIcon'

interface ViewerHeaderProps {
  headerTitle: string
  headerSubtitle: string
  hasExternalData: boolean
  selectorMethods: MethodEntry[]
  hasInputVarSelector: boolean
  currentMethodBase: string | null
  selectedMethod: string
  onMethodSelect: (slug: string) => void
  currentInputVarOptions: Array<{ slug: string; inputVar: string }>
  activeInputVar: string | null
  onInputVarChange: (inputVar: string) => void
}

export function ViewerHeader({
  headerTitle,
  headerSubtitle,
  hasExternalData,
  selectorMethods,
  hasInputVarSelector,
  currentMethodBase,
  selectedMethod,
  onMethodSelect,
  currentInputVarOptions,
  activeInputVar,
  onInputVarChange,
}: ViewerHeaderProps) {
  const selectedDisplayId = hasInputVarSelector
    ? (currentMethodBase ? selectorMethods.find((m) => m.label === currentMethodBase)?.id ?? selectedMethod : selectedMethod)
    : selectedMethod
  const showInputVarLabel = hasExternalData && activeInputVar !== null && currentInputVarOptions.length > 0

  return (
    <header
      className="shrink-0 border-b border-border/50 bg-card/50 backdrop-blur-md safe-area-inset-top"
      data-geoxplain-screenshot-exclude
    >
      <div className="px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
            <GlobeIcon className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">{headerTitle}</h1>
            {headerSubtitle && (
              <p className="text-xs text-muted-foreground hidden sm:block">
                {headerSubtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 flex items-center gap-2">
            {hasExternalData && selectorMethods.length > 0 && (
              <MethodSelector
                methods={selectorMethods}
                selectedId={selectedDisplayId}
                onSelect={onMethodSelect}
              />
            )}
            {showInputVarLabel && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={currentInputVarOptions.length > 1 ? 'text-xs text-muted-foreground hidden sm:inline' : 'text-xs text-muted-foreground'}>
                  w.r.t.
                </span>
                {currentInputVarOptions.length > 1 ? (
                  <select
                    value={activeInputVar ?? ''}
                    onChange={(e) => onInputVarChange(e.target.value)}
                    className="h-8 rounded-md border border-border/60 bg-card/85 px-2 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                    aria-label="Input variable"
                    title="Attribution input variable"
                  >
                    {currentInputVarOptions.map(({ inputVar }) => (
                      <option key={inputVar} value={inputVar}>{inputVar}</option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="flex h-8 items-center text-xs font-medium text-foreground"
                    aria-label={`Input variable: ${activeInputVar}`}
                    title="Attribution input variable"
                  >
                    {activeInputVar}
                  </span>
                )}
              </div>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
