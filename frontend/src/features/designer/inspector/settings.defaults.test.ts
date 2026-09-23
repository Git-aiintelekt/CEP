/**
 * The drift guard for MJML_DEFAULTS and ATTRIBUTE_RULES: both are copied out of mjml's own component
 * declarations, so this reads them back out of the installed package and fails if an upgrade moves them.
 */
import { expect, test } from 'vitest'

// the installed package itself, read as text: no node types needed, and it is the same file the editor compiles with
import bundle from 'mjml-browser/lib/index.js?raw'

import { ATTRIBUTE_RULES, MJML_DEFAULTS } from './settings'

/** Pulls `(0, x)(Component, "<what>", { ... })` blocks out of the built bundle and names them by componentName. */
function declarations(what: 'defaultAttributes' | 'allowedAttributes'): Record<string, Record<string, unknown>> {
  const found: Record<string, Record<string, unknown>> = {}
  const opening = new RegExp(`"${what}",\\{`, 'g')
  let match: RegExpExecArray | null

  while ((match = opening.exec(bundle)) !== null) {
    let index = match.index + match[0].length - 1
    let depth = 0
    const start = index
    for (; index < bundle.length; index++) {
      if (bundle[index] === '{') depth++
      else if (bundle[index] === '}' && --depth === 0) break
    }
    const names = [...bundle.slice(Math.max(0, match.index - 6000), match.index).matchAll(/"componentName","(mj-[a-z-]+)"/g)]
    const name = names.at(-1)?.[1]
    if (name === undefined) continue
    try {
      found[name] = JSON.parse(bundle.slice(start, index + 1).replace(/([,{])([a-zA-Z-][a-zA-Z0-9-]*):/g, '$1"$2":'))
    } catch {
      // a shape this reader cannot parse is caught by the assertions below, which will not find their keys
    }
  }
  return found
}

test('the extractor finds the blocks we edit, so a silent miss cannot pass the tests below', () => {
  const defaults = declarations('defaultAttributes')
  for (const type of Object.keys(MJML_DEFAULTS)) expect(Object.hasOwn(defaults, type), type).toBe(true)
  expect(defaults['mj-spacer']).toEqual({ height: '20px' })
})

test('every default we hold is the one mjml itself declares', () => {
  const declared = declarations('defaultAttributes')
  for (const [type, settings] of Object.entries(MJML_DEFAULTS)) {
    for (const [key, value] of Object.entries(settings)) {
      expect(String(declared[type]?.[key] ?? null), `${type} ${key}`).toBe(value)
    }
  }
})

test('a setting we hold no default for really has none in mjml', () => {
  const declared = declarations('defaultAttributes')
  for (const [type, rules] of Object.entries(ATTRIBUTE_RULES)) {
    for (const key of Object.keys(rules)) {
      if (Object.hasOwn(MJML_DEFAULTS[type] ?? {}, key)) continue
      expect(declared[type]?.[key] ?? null, `${type} ${key} gained a default`).toBe(null)
    }
  }
})

/** `unit(px,%){1,4}` -> units px and %, up to four values; `color` and `string` map to our two other rules. */
function ruleFromMjml(declared: string): { units: string[]; parts: number } | 'color' | 'free' {
  if (declared === 'color') return 'color'
  const unit = /^unit\(([^)]*)\)(?:\{1,(\d)\})?$/.exec(declared)
  if (!unit) return 'free'
  return { units: unit[1].split(',').map((part) => part.trim()), parts: Number(unit[2] ?? 1) }
}

test('every unit rule we enforce is the one mjml validates against', () => {
  const declared = declarations('allowedAttributes')
  for (const [type, rules] of Object.entries(ATTRIBUTE_RULES)) {
    for (const [key, rule] of Object.entries(rules)) {
      const theirs = declared[type]?.[key]
      if (theirs === undefined) continue // a key mjml does not validate, such as a button's label
      const expected = ruleFromMjml(String(theirs))
      if (rule === 'free' || rule === 'color') {
        expect(expected, `${type} ${key}`).toBe(rule)
        continue
      }
      expect(expected, `${type} ${key}`).toEqual({ units: [...rule.units], parts: rule.parts ?? 1 })
    }
  }
})
