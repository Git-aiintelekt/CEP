import { afterEach, expect, test } from 'vitest'

import css from '../index.css?raw'
import { readThemePreference, resolveTheme, setThemePreference, THEME_STORAGE_KEY } from './theme'

function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThan(-1)
  const body = css.slice(start, css.indexOf('}', start))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
}

const themeColours = [...css.slice(0, css.indexOf('[data-theme="light"] {')).matchAll(/^\s*(--color-[\w-]+):/gm)].map(([, name]) => name)
/** only ever drawn inside a light-scoped Home hero card */
const LIGHT_ONLY = new Set(['--color-home-hero-rule', '--color-home-hero-plum-rule'])

afterEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

test('the light and dark blocks set the same tokens', () => {
  expect([...tokensIn('[data-theme="dark"]').keys()].sort()).toEqual([...tokensIn('[data-theme="light"]').keys()].sort())
})

test('every colour token has a dark value', () => {
  const dark = tokensIn('[data-theme="dark"]')
  const missing = themeColours.filter((name) => !dark.has(name) && !LIGHT_ONLY.has(name))
  expect(missing).toEqual([])
})

test('the light block repeats the @theme values, so a light panel inside a dark page looks the same as the light page', () => {
  const light = tokensIn('[data-theme="light"]')
  const differs = themeColours.filter((name) => {
    const declared = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))?.[1].trim()
    return light.has(name) && declared && !declared.startsWith('var(') && declared.toLowerCase() !== light.get(name)!.toLowerCase()
  })
  expect(differs).toEqual([])
})

const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const PALETTE = /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/

test('components colour themselves only through tokens: no Tailwind palette classes or arbitrary hex', () => {
  const offenders = Object.entries(sources).flatMap(([file, source]) =>
    source.split('\n').flatMap((line, index) => (PALETTE.test(line) || ARBITRARY_HEX.test(line) ? [`${file}:${index + 1}`] : [])),
  )
  expect(offenders).toEqual([])
})

test('the theme is light until someone picks another', () => {
  expect(readThemePreference()).toBe('light')
  window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
  expect(readThemePreference()).toBe('light')
})

test('picking a theme stores it and sets it on the page', () => {
  setThemePreference('dark')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  setThemePreference('light')
  expect(document.documentElement.dataset.theme).toBe('light')
})

test('system follows the operating system', () => {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: query.includes('dark'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  try {
    expect(resolveTheme('system')).toBe('dark')
  } finally {
    window.matchMedia = original
  }
})
