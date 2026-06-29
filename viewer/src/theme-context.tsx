import { createContext, useContext } from 'react'

interface ThemeContextValue {
  scopedRoot: HTMLElement | null
}

export const ThemeContext = createContext<ThemeContextValue>({ scopedRoot: null })

export function useThemeContext() {
  return useContext(ThemeContext)
}
