import type { Preferences } from '../types'

export const THEME_STORAGE_KEY = 'nutrienttrack-theme'

type Theme = NonNullable<Preferences['theme']>
type MacroDisplay = NonNullable<Preferences['macroDisplay']>

/** Read preferences from a stored record that may come from another build: unknown or malformed values fall back to the defaults. */
export const readPreferences = (value: unknown): Required<Pick<Preferences, 'theme' | 'macroDisplay'>> => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const theme: Theme = raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system'
  const macroDisplay: MacroDisplay = raw.macroDisplay === 'percent' ? 'percent' : 'grams'
  return { theme, macroDisplay }
}

/** Put the theme on the page. "system" removes the override so the browser's colour scheme decides. */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  // Mirrored outside the database only so the next load can paint the right theme before the data opens.
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The theme still applies for this session.
  }
}

/** Energy share of each macro: protein and carbs 4 kcal/g, fat 9 kcal/g. Null when there is nothing to divide. */
export const macroShares = (macros: { protein: number; carbs: number; fat: number }): { protein: number; carbs: number; fat: number } | null => {
  const energy = { protein: macros.protein * 4, carbs: macros.carbs * 4, fat: macros.fat * 9 }
  const total = energy.protein + energy.carbs + energy.fat
  if (!(total > 0)) return null
  return { protein: (energy.protein / total) * 100, carbs: (energy.carbs / total) * 100, fat: (energy.fat / total) * 100 }
}
