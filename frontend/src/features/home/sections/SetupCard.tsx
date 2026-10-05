import { ChevronRight, ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { WorkspaceSetup } from '@/lib/types'

import { setupWanted } from '@/features/setup/setup'

import type { SectionResult } from '../data/types'
import { IntroBar } from '../intro'

/** Under the alerts, for administrators, until the workspace is ready or the card is hidden: how far the set-up is and what comes next. */
export function SetupCard({ result }: { result: SectionResult<WorkspaceSetup | null> }) {
  if (result.status !== 'ready' || !setupWanted(result.data)) return null
  const data = result.data
  const next = data.steps.find((step) => step.key === data.next)
  const percent = data.total ? Math.round((data.done / data.total) * 100) : 0
  return (
    <section aria-label="Workspace set-up" data-setup-card className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3.5">
      <span aria-hidden className="cep-home-blend-diagonal flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"><ListChecks size={20} strokeWidth={1.5} /></span>
      <span className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] leading-tight font-semibold text-ink-900">Set Up Your Workspace</span>
          <span className="inline-flex h-[22px] items-center rounded-sm bg-plum-100 px-2 text-xs font-semibold whitespace-nowrap text-plum-800">{data.done} of {data.total} done</span>
        </span>
        <span className="text-helper text-ink-800">{next ? `Next: ${next.label}. ${next.text}` : 'The required steps are done.'}</span>
      </span>
      <div role="progressbar" aria-label="Workspace set-up" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="hidden h-2 w-[220px] overflow-hidden rounded-pill bg-fill-subtle @min-[840px]:block">
        <IntroBar as="div" className="cep-home-blend rounded-pill" percent={percent} />
      </div>
      <Link to="/settings/setup" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-control-md border border-line-control bg-surface px-3 text-sm font-semibold whitespace-nowrap text-brand-600 transition-colors duration-fast ease-standard hover:bg-surface-subtle">
        Continue Set-Up<ChevronRight size={14} strokeWidth={2} aria-hidden />
      </Link>
    </section>
  )
}
