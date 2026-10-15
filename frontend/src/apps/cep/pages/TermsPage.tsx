/** /terms: the platform's Terms of Use, as the back-office's Legal parameters hold them (GET /legal/), readable without
 * signing in. Linked from the sign-in page's footer and from every page's foot. */
import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

import { LegalFooter, useLegal } from '@/components/LegalFooter'
import { ErrorState, Spinner } from '@/components/States'
import { Markdown } from '@/apps/cep/help/markdown'
import { formatDate } from '@/lib/format'

export default function TermsPage() {
  const legal = useLegal()
  return (
    <div className="min-h-screen bg-surface px-6 py-8">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-xl font-semibold tracking-[-0.02em] text-wordmark-navy">C360</span>
            <span aria-hidden className="h-3.5 w-px bg-fill-muted" />
            <span className="text-helper text-ink-800">Customer Insights Platform</span>
          </div>
          <Link to="/login" className="inline-flex items-center gap-1 text-helper text-brand-800 hover:underline">
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden /> Back to Log In
          </Link>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-page-title font-semibold text-ink-900">{legal.data?.terms.title ?? 'Terms of Use'}</h1>
          {legal.data?.terms.updated_at && <p className="text-helper text-ink-800">Last updated {formatDate(legal.data.terms.updated_at)}</p>}
        </div>
        {legal.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading the terms</p>
          : legal.isError ? <ErrorState title="The terms could not be loaded" error={legal.error} onRetry={() => void legal.refetch()} />
          : legal.data.terms.body.trim() === '' ? <p className="text-sm text-ink-800">The platform has not published its terms yet.</p>
          : <article className="rounded-lg border border-line bg-surface p-6"><Markdown source={legal.data.terms.body} /></article>}
        <LegalFooter />
      </div>
    </div>
  )
}
