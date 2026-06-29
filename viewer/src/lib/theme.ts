export type ThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'xai-theme'

export function getCurrentTheme(scopedRoot?: HTMLElement | null): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored

  const root = scopedRoot ?? document.documentElement
  return root.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(theme: ThemeMode, scopedRoot?: HTMLElement | null): void {
  const root = scopedRoot ?? document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
    if (scopedRoot) document.documentElement.classList.remove('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}
