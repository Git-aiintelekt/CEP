/**
 * Explain This Report: a few sentences from the AI on what the rows show, above the result. The model reads the report's
 * name, its columns and up to 100 of the rows this person sees, with masked columns left out; it counts as one prompt.
 */
import { Sparkles, X } from 'lucide-react'

import { IconButton } from '@/components/Button'
import { Spinner } from '@/components/States'
import type { Explanation } from '../types'

export function ExplainPanel({ pending, error, explanation, onClose, onRetry }: { pending: boolean; error: string | null; explanation: Explanation | null; onClose: () => void; onRetry: () => void }) {
  return (
    <section aria-label="Explanation" className="flex flex-col gap-2 rounded-md border border-line bg-surface-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900"><Sparkles size={16} strokeWidth={1.5} aria-hidden className="text-plum-700" />What This Report Shows</h2>
        <IconButton label="Close the explanation" icon={X} size="xs" onClick={onClose} />
      </div>
      {pending ? <Spinner label="Reading the rows" /> : error ? (
        <p role="alert" className="text-sm text-danger-text">{error} <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={onRetry}>Try Again</button></p>
      ) : explanation && (
        <>
          <p className="max-w-prose text-sm text-ink-900">{explanation.summary}</p>
          {explanation.points.length > 0 && (
            <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-sm text-ink-900">
              {explanation.points.map((point, index) => <li key={index}>{point}</li>)}
            </ul>
          )}
          {explanation.caution && <p className="max-w-prose text-xs text-ink-800">{explanation.caution}</p>}
          <p className="text-xs text-ink-700">
            {explanation.model ? `Written by ${explanation.model.label} from ${explanation.rows_sent ?? 0} ${explanation.rows_sent === 1 ? 'row' : 'rows'}` : 'Written from the rows'}
            {explanation.left_out?.length ? `, without ${explanation.left_out.join(', ')}` : ''}. Check the figures before you act on them.
          </p>
        </>
      )}
    </section>
  )
}
