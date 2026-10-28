/** What This Means in words: a figure as the engine's rules write it, its note, and the brief as plain text for an email. */
import type { Meaning, MeaningFigure } from '../types'

/** a figure as the engine's rules write it: a percent under 1 to two places */
export function meaningNumber(value: number | null | undefined, format: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (format === 'percent') return `${value.toFixed(Math.abs(value) < 1 ? 2 : 1)}%`
  if (format === 'money') return Math.abs(value) >= 100_000 ? `$${Math.round(value / 1000).toLocaleString()}K` : `$${value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0 })}`
  if (format === 'decimal') return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return Math.round(value).toLocaleString()
}

export function figureNote(figure: MeaningFigure): string {
  if (figure.estimated) return figure.range ? `estimated · ${meaningNumber(figure.range[0], figure.format)} to ${meaningNumber(figure.range[1], figure.format)}` : 'estimated'
  const earlier = figure.earlier !== null ? `earlier ${meaningNumber(figure.earlier, figure.format)}` : ''
  return [figure.target, earlier].filter(Boolean).join(' · ')
}

/** the brief as plain text, to paste into an email */
export function meaningText(name: string, meaning: Meaning): string {
  const lines = [`${name}: ${meaning.verdict.title}`]
  if (meaning.verdict.summary) lines.push(meaning.verdict.summary)
  lines.push('', ...meaning.figures.map((f) => `${f.label}: ${f.estimated ? 'about ' : ''}${meaningNumber(f.value, f.format)}${f.words ? ` (${f.words.toLowerCase()}${f.target ? `, ${f.target}` : ''})` : ''}${f.estimated ? ', estimated' : ''}`))
  if (meaning.reasons.length) lines.push('', 'Why', ...meaning.reasons.map((r) => `- ${r.text}`))
  if (meaning.actions.length) lines.push('', 'Do next', ...meaning.actions.map((a, i) => `${i + 1}. ${a.text}`))
  return lines.join('\n')
}
