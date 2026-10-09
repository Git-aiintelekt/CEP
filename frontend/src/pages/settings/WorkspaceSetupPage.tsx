/**
 * Settings → Set-Up: the seven steps of a new workspace, each read from the workspace (never ticked by hand), with the page
 * that does it. The first sign-in of an administrator lands here while the workspace is not ready; the Home card leads back
 * until it is ready or hidden with Hide Until Later.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Notice } from '@/components/Notice'
import { ProgressBar } from '@/components/ProgressBar'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { buttonClass } from '@/components/buttonStyles'
import { api } from '@/lib/api'
import type { SetupStep, WorkspaceSetup } from '@/lib/types'

import { SETUP_KEY, fetchSetup } from '@/features/setup/setup'

const TAG = 'inline-flex h-[22px] shrink-0 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap'
const TAG_TONE = { ok: 'bg-success-bg text-success-text', warn: 'bg-warning-bg text-warning-text', grey: 'bg-fill-subtle text-ink-800' }

function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: string }) {
  return <span className={`${TAG} ${TAG_TONE[tone]}`}>{children}</span>
}

/** a tick when done; otherwise the step's number, blue for the next step, amber for one that needs attention */
function Mark({ step, number, current }: { step: SetupStep; number: number; current: boolean }) {
  if (step.state === 'done') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-text">
        <Check size={14} strokeWidth={2.5} aria-hidden /><span className="sr-only">Done</span>
      </span>
    )
  }
  const tone = current ? 'bg-brand-600 text-on-brand' : step.state === 'warn' ? 'bg-warning-bg text-warning-text' : 'border border-line bg-fill-subtle text-ink-800'
  return <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone}`}>{number}</span>
}

function StepRow({ step, number, current }: { step: SetupStep; number: number; current: boolean }) {
  return (
    <li data-step={step.key} data-state={current ? 'now' : step.state} className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5 border-b border-line-subtle px-4 py-3.5 last:border-b-0">
      <Mark step={step} number={number} current={current} />
      <div className="min-w-0 flex-[1_1_260px]">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-900">{step.label}{step.optional && <Tag tone="grey">Optional</Tag>}</p>
        <p className="mt-0.5 text-sm text-ink-800">{step.text}</p>
        {current && step.why && <p data-why className="mt-1.5 rounded-control-md bg-surface-subtle px-2.5 py-2 text-helper text-ink-800">{step.why}</p>}
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        {step.tag && <Tag tone={step.state === 'done' ? 'ok' : 'warn'}>{step.tag}</Tag>}
        {step.links.map((link) => (
          <Link key={link.to} to={link.to} className={buttonClass({ variant: current && link.primary ? 'primary' : 'secondary', size: 'sm' })}>{link.label}</Link>
        ))}
      </div>
    </li>
  )
}

export function WorkspaceSetupPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const setup = useQuery({ queryKey: SETUP_KEY, queryFn: ({ signal }) => fetchSetup(signal) })
  const hide = useMutation({
    mutationFn: (dismissed: boolean) => api.put<WorkspaceSetup>('/workspace/setup/', { dismissed }),
    onSuccess: (next, dismissed) => {
      if (dismissed) toast.success('Set-up card hidden', 'The steps stay here under Settings until you show the card again.')
      else toast.success('Set-up card shown', 'Home shows the steps again.')
      queryClient.setQueryData(SETUP_KEY, next)
    },
  })

  if (setup.isError) return <ErrorState title="The set-up steps could not be loaded" error={setup.error} onRetry={() => void setup.refetch()} />
  if (setup.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = setup.data
  const fresh = data.done <= 1
  const facts = [`${data.workspace.name} (${data.workspace.code})`, data.workspace.plan, data.workspace.timezone].filter(Boolean).join(' · ')
  const percent = data.total ? (data.done / data.total) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="font-display text-section-title font-semibold text-ink-900">{fresh ? `Welcome, ${data.viewer.first_name}. Let's set up ${data.workspace.code}.` : 'Set Up Your Workspace'}</h2>
          <p className="mt-0.5 text-sm text-ink-800">
            {facts}. {fresh ? 'Seven steps, about an hour if the sending credentials are to hand. Nothing sends until step 4.' : 'Work the steps in order; each one opens the page that does it.'}
          </p>
        </div>
        {!data.ready && (
          <button type="button" onClick={() => hide.mutate(!data.dismissed)} disabled={hide.isPending} className={buttonClass({ variant: 'secondary' })}>
            {data.dismissed ? 'Show on Home Again' : 'Hide Until Later'}
          </button>
        )}
      </div>

      <section aria-label="Set-Up" className="max-w-4xl rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-4 py-3">
          <h3 className="flex items-center gap-2 font-display text-card-heading font-semibold text-ink-900">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-control-md bg-brand-100 text-brand-800"><ListChecks size={16} strokeWidth={1.5} /></span>Set-Up
          </h3>
          <div className="flex w-full max-w-[280px] items-center gap-3">
            <span className="shrink-0 text-helper text-ink-800">{data.done} of {data.total} done</span>
            <ProgressBar value={percent} label="Set-up progress" />
          </div>
        </div>
        <ol className="list-none">
          {data.steps.map((step, index) => <StepRow key={step.key} step={step} number={index + 1} current={step.key === data.next} />)}
        </ol>
      </section>

      {data.ready ? (
        <Notice tone="info" layout="banner" title="Your workspace is ready">
          Home offers Create Campaign. The optional steps can be done any time; the first campaign's Review step runs the same checks before it publishes.
        </Notice>
      ) : (
        <Notice tone="info" layout="banner" title="When steps 1 to 4 and 6 are done, the workspace is ready">
          Home offers Create Campaign, and the first campaign's Review step runs the same checks before it publishes.
        </Notice>
      )}
      {hide.isError && <ErrorState title={hide.variables ? 'The card was not hidden' : 'The card was not shown again'} error={hide.error} />}
    </div>
  )
}
