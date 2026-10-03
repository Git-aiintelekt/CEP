import { ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { WorkspaceSetup } from '@/lib/types'

import { setupWanted } from '@/features/setup/setup'

import type { SectionResult } from '../data/types'

/** Under the alerts, for administrators, until the workspace is ready or the card is hidden: how far the set-up is and what comes next. */
export function SetupCard({ result }: { result: SectionResult<WorkspaceSetup | null> }) {
  if (result.status !== 'ready' || !setupWanted(result.data)) return null
  const data = result.data
  const next = data.steps.find((step) => step.key === data.next)
  return (
    <section aria-label="Workspace set-up" data-setup-card className="flex min-h-[88px] items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-brand-100 text-brand-800"><ListChecks size={16} strokeWidth={1.5} /></span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-sm font-semibold text-ink-900">Set Up Your Workspace · {data.done} of {data.total} done</span>
        <span className="truncate text-helper text-ink-800">{next ? `Next: ${next.label}. ${next.text}` : 'The required steps are done.'}</span>
      </span>
      <Link to="/settings/setup" className="shrink-0 text-sm font-semibold text-brand-600 hover:underline">Continue Set-Up</Link>
    </section>
  )
}
