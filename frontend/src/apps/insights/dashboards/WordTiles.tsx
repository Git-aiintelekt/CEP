/**
 * The tiles without a report: a text tile (a heading of the dashboard's own, a note on how to read it) and a button that opens a
 * saved view, goes to a page or opens a report. Text keeps to a small, safe set: paragraphs, lines starting "- " as bullets, and
 * **bold**; nothing in it is ever read as HTML.
 */
import { ArrowRight } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { buttonSecondary } from '@/components/Form'
import type { DashboardTile } from '../types'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4
    ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    : <Fragment key={i}>{part}</Fragment>))
}

export function TextTile({ tile, controls }: { tile: DashboardTile; controls?: ReactNode }) {
  const blocks = (tile.text ?? '').split(/\n\s*\n/).map((block) => block.split('\n').filter((line) => line.trim()))
  return (
    <section aria-label={tile.title || 'Text'} data-text-tile className="flex h-full min-w-0 flex-col rounded-md border border-line bg-surface">
      {(tile.title || controls) && (
        <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{tile.title || ' '}</h3>
          {controls}
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-2.5 text-sm text-ink-900">
        {blocks.map((lines, b) => (lines.every((line) => line.trimStart().startsWith('- '))
          ? <ul key={b} className="flex list-disc flex-col gap-1 pl-5">{lines.map((line, l) => <li key={l}>{inline(line.trimStart().slice(2))}</li>)}</ul>
          : <p key={b} className="max-w-prose">{lines.map((line, l) => <Fragment key={l}>{l > 0 && <br />}{inline(line)}</Fragment>)}</p>))}
      </div>
    </section>
  )
}

export function ButtonTile({ tile, onAction, controls }: { tile: DashboardTile; onAction?: (action: NonNullable<DashboardTile['action']>) => void; controls?: ReactNode }) {
  return (
    <div data-button-tile className="flex h-full min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <button type="button" className={`${buttonSecondary} min-w-0 flex-1 justify-between`} disabled={!onAction || !tile.action} onClick={() => tile.action && onAction?.(tile.action)}>
        <span className="truncate">{tile.label}</span><ArrowRight size={16} strokeWidth={1.5} aria-hidden />
      </button>
      {controls}
    </div>
  )
}
