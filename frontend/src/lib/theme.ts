import { useSyncExternalStore } from 'react'

/** The person's choice. "system" follows the operating system and changes with it. Light is the default. */
export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

/** also read by the inline script in index.html, which sets the theme before the first paint */
export const THEME_STORAGE_KEY = 'cep-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()

function isPreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(stored) ? stored : 'light'
  } catch {
    return 'light'
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(readThemePreference())
  listeners.forEach((listener) => listener())
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // storage blocked: the choice still applies for this visit
  }
  document.documentElement.dataset.theme = resolveTheme(preference)
  listeners.forEach((listener) => listener())
}

/** Applies the stored choice and keeps "system" and other tabs in step. Call once, before the app renders. */
export function installTheme() {
  applyTheme()
  if (typeof window.matchMedia === 'function') window.matchMedia(DARK_QUERY).addEventListener('change', applyTheme)
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) applyTheme()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, readThemePreference, () => 'light' as const)
  return [preference, setThemePreference]
}
