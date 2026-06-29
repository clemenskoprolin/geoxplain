import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { MethodEntry } from '@/components/xai/method-selector'
import type { DenseGridInput } from '@/types'
import { parseInputVarLabel } from '@/components/attributionViewer/viewerHelpers'

/**
 * Splits labels like "<base> (<var>)" for display, while leaving plain method
 * names untouched. Multi-variable bases get an input-variable selector; single
 * parsed variables are exposed as read-only label text.
 */
export function useMethodSelection(
  externalData: DenseGridInput | null,
  selectedMethod: string,
  setSelectedMethod: Dispatch<SetStateAction<string>>,
) {
  const [selectedInputVar, setSelectedInputVar] = useState<string | null>(null)

  const inputVarGroups = useMemo(() => {
    if (!externalData) return new Map<string, Array<{ slug: string; inputVar: string }>>()
    const groups = new Map<string, Array<{ slug: string; inputVar: string }>>()
    for (const [slug, m] of Object.entries(externalData.methods)) {
      const parsed = parseInputVarLabel(m.label)
      if (!parsed) continue
      if (!groups.has(parsed.base)) groups.set(parsed.base, [])
      groups.get(parsed.base)!.push({ slug, inputVar: parsed.inputVar })
    }
    return groups
  }, [externalData])

  const hasInputVarSelector = useMemo(
    () => Array.from(inputVarGroups.values()).some((entries) => entries.length > 1),
    [inputVarGroups],
  )

  const selectorMethods = useMemo<MethodEntry[]>(() => {
    if (!externalData) return []
    if (inputVarGroups.size === 0) {
      return Object.entries(externalData.methods).map(([slug, m]) => ({
        id: slug,
        label: m.label,
        shortLabel: m.shortLabel,
      }))
    }
    const seenMultiVarBases = new Set<string>()
    const entries: MethodEntry[] = []
    for (const [slug, m] of Object.entries(externalData.methods)) {
      const parsed = parseInputVarLabel(m.label)
      if (!parsed) {
        entries.push({ id: slug, label: m.label, shortLabel: m.shortLabel })
        continue
      }

      const group = inputVarGroups.get(parsed.base)
      if (group && group.length > 1) {
        if (seenMultiVarBases.has(parsed.base)) continue
        seenMultiVarBases.add(parsed.base)
      }
      entries.push({ id: slug, label: parsed.base, shortLabel: parsed.base })
    }
    return entries
  }, [externalData, inputVarGroups])

  const currentMethodBase = useMemo(() => {
    if (!externalData) return null
    const m = externalData.methods[selectedMethod]
    if (!m) return null
    const parsed = parseInputVarLabel(m.label)
    return parsed ? parsed.base : null
  }, [externalData, selectedMethod])

  const currentInputVarOptions = useMemo(
    () => (currentMethodBase ? (inputVarGroups.get(currentMethodBase) ?? []) : []),
    [currentMethodBase, inputVarGroups],
  )

  const activeInputVar = useMemo(() => {
    if (!externalData) return null
    const m = externalData.methods[selectedMethod]
    if (!m) return null
    const parsed = parseInputVarLabel(m.label)
    return parsed ? parsed.inputVar : null
  }, [externalData, selectedMethod])

  // Keep the selected input var valid when options change.
  useEffect(() => {
    if (!hasInputVarSelector || currentInputVarOptions.length === 0) return
    const defaultVar = currentInputVarOptions[0].inputVar
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedInputVar((prev) => {
      const found = currentInputVarOptions.find((e) => e.inputVar === prev)
      return found ? prev : defaultVar
    })
  }, [hasInputVarSelector, currentInputVarOptions])

  const handleInputVarChange = useCallback((inputVar: string) => {
    if (!currentMethodBase) return
    const group = inputVarGroups.get(currentMethodBase)
    const entry = group?.find((e) => e.inputVar === inputVar)
    if (entry) {
      setSelectedMethod(entry.slug)
      setSelectedInputVar(inputVar)
    }
  }, [currentMethodBase, inputVarGroups, setSelectedMethod])

  // Preserve the current input var when switching base methods.
  const handleMethodSelect = useCallback((slug: string) => {
    if (!hasInputVarSelector) {
      setSelectedMethod(slug)
      return
    }
    const m = externalData?.methods[slug]
    const parsed = m ? parseInputVarLabel(m.label) : null
    const base = parsed ? parsed.base : null
    if (!base) {
      setSelectedMethod(slug)
      return
    }
    const group = inputVarGroups.get(base)
    if (!group) {
      setSelectedMethod(slug)
      return
    }
    const preferred = group.find((e) => e.inputVar === selectedInputVar) ?? group[0]
    setSelectedMethod(preferred.slug)
    setSelectedInputVar(preferred.inputVar)
  }, [hasInputVarSelector, externalData, inputVarGroups, selectedInputVar, setSelectedMethod])

  // Auto-select the first method if the current slug disappears with new data.
  useEffect(() => {
    if (!externalData) return
    const firstSlug = Object.keys(externalData.methods)[0]
    if (firstSlug && !externalData.methods[selectedMethod]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleMethodSelect(firstSlug)
    }
  }, [externalData, handleMethodSelect, selectedMethod])

  return {
    selectorMethods,
    hasInputVarSelector,
    currentMethodBase,
    currentInputVarOptions,
    activeInputVar,
    handleInputVarChange,
    handleMethodSelect,
  }
}
