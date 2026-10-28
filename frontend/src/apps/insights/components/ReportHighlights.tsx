/**
 * Highlights under a report's result (docs/mockups/report-page.html): up to four lines the rules write from the rows, at
 * no AI cost. When the workspace allows Explain's AI, Explain With AI swaps them for the AI's summary and points (one
 * prompt, asked for only on the click), with its usual note to check the figures.
 */
import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { buttonClass } from '@/components/buttonStyles'
import type { Explanation, RunResult } from '../types'
import { RowsView } from './ExplainPanel'
import { highlights, type Highlight } from './highlights'

const DOT: Record<Highlight['tone'], string> = { up: 'bg-success-text', down: 'bg-warning-text', plain: 'bg-ink-300' }

interface AiExplain { explain: () => void; pending: boolean; error: string | null; explanation: Explanation | null }

export function ReportHighlights({ result, ai }: { result: RunResult; ai: AiExplain | null }) {
  const lines = useMemo(() => highlights(result), [result])
  const [asked, setAsked] = useState(false)
  if (lines.length === 0) return null
  return (
    <section aria-labelledby="report-highlights" className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="report-highlights" className="font-display text-card-heading font-semibold text-ink-900">Highlights</h2>
        <span className="text-helper text-ink-800">{asked ? 'Written by AI from these rows' : 'Worked out from these rows'}</span>
        {ai && (
          <button type="button" className={`${buttonClass({ variant: 'secondary', size: 'sm' })} ml-auto`} onClick={() => { if (asked) setAsked(false); else { setAsked(true); if (!ai.explanation) ai.explain() } }}>
            {asked ? 'Back to Highlights' : <><Sparkles size={14} strokeWidth={1.5} aria-hidden />Explain With AI</>}
          </button>
        )}
      </div>
      {asked && ai ? <RowsView pending={ai.pending} error={ai.error} explanation={ai.explanation} onRetry={ai.explain} /> : (
        <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
          {lines.map((line, index) => (
            <li key={index} className="flex items-start gap-2.5 py-1.5 text-sm text-ink-800">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[line.tone]}`} />
              <p><span className="font-semibold text-ink-900">{line.lead}</span>{line.rest}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
