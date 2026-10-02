/**
 * The designer's Deliverability tab: run inbox previews of the saved design through the workspace's Mailgun Inspect
 * account, within the plan's monthly allowance, and look at every client's render. The spam verdict and inbox
 * placement have their cards already; they fill in when those services are added.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Inbox, ShieldCheck, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { DeliverabilityAllowance, DeliverabilityPreview, DeliverabilityTest } from '@/lib/types'

import type { DeliverabilityBackend } from './backend'

const POLL_MS = 8000
const CATEGORY_ORDER = ['Web', 'Application', 'Mobile']
const CATEGORY_LABEL: Record<string, string> = { Web: 'Webmail', Application: 'Desktop Apps', Mobile: 'Phones and Tablets' }
const STATUS_LABEL: Record<DeliverabilityTest['status'], string> = { PENDING: 'Queued', PROCESSING: 'Rendering', COMPLETE: 'Complete', FAILED: 'Failed' }
const BADGE: Record<DeliverabilityTest['status'], string> = { PENDING: 'PREPARING', PROCESSING: 'SENDING', COMPLETE: 'COMPLETED', FAILED: 'FAILED' }

interface PanelProps {
  backend: DeliverabilityBackend
  /** the tab is open; nothing is fetched until it is */
  active: boolean
  /** the version a test would use (the last saved one); 0 = never saved */
  savedVersion: number
  /** unsaved changes: the test would not include them */
  dirty: boolean
  readOnly?: boolean
}

export function DeliverabilityPanel({ backend, active, savedVersion, dirty, readOnly = false }: PanelProps) {
  const queryClient = useQueryClient()
  const key = useMemo(() => ['deliverability', backend] as const, [backend])
  const list = useQuery({ queryKey: [...key, 'tests'], queryFn: backend.list, enabled: active, staleTime: 10_000 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const currentId = selectedId ?? list.data?.tests[0]?.id ?? null
  const detail = useQuery({
    queryKey: [...key, 'test', currentId],
    queryFn: () => backend.read(currentId as string),
    enabled: active && currentId !== null,
    refetchInterval: (query) => (query.state.data && (query.state.data.status === 'PENDING' || query.state.data.status === 'PROCESSING') ? POLL_MS : false),
  })
  useEffect(() => {
    // the history row keeps up with the detail's progress
    if (detail.data) queryClient.setQueryData<typeof list.data>([...key, 'tests'], (now) => now && { ...now, tests: now.tests.map((t) => (t.id === detail.data.id ? { ...detail.data, previews: [] } : t)) })
  }, [detail.data, key, queryClient])

  const start = useMutation({
    mutationFn: backend.start,
    onSuccess: (test) => { setSelectedId(test.id); void queryClient.invalidateQueries({ queryKey: [...key, 'tests'] }) },
  })
  const [zoom, setZoom] = useState<DeliverabilityPreview | null>(null)

  if (!active && !list.data) return null
  if (list.isError) return <div className="p-6"><ErrorState error={list.error} onRetry={() => void list.refetch()} /></div>
  if (!list.data) return <p className="flex items-center gap-2 p-6 text-sm text-ink-800"><Spinner size="sm" /> Loading tests</p>

  const { allowance, tests } = list.data
  const blocker = blockerFor({ allowance, savedVersion, readOnly })
  const current = detail.data ?? tests.find((t) => t.id === currentId) ?? null
  const startError = start.error instanceof ApiError ? start.error.problem.detail ?? start.error.message : start.error ? String(start.error) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Deliverability</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-800">
            How the saved design renders in real inbox clients, through your Mailgun Inspect account. Tests use the last saved version
            {savedVersion > 0 ? ` (v${savedVersion})` : ''}{dirty ? ': save first to test your latest changes.' : '.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="primary" disabled={blocker !== null || start.isPending} loading={start.isPending} onClick={() => start.mutate()}>Run Inbox Previews</Button>
          <AllowanceLine allowance={allowance} />
        </div>
      </header>

      {blocker && <Notice tone={blocker.tone} layout="strip">{blocker.text}{blocker.link && <> <Link to={blocker.link.to} className="font-medium underline">{blocker.link.label}</Link></>}</Notice>}
      {startError && <Notice tone="error" layout="strip">{startError}</Notice>}

      {tests.length === 0 ? (
        <EmptyState icon={Eye} title="No tests yet" hint="Run Inbox Previews to see this email in Gmail, Outlook, Apple Mail and the rest, exactly as each one renders it." />
      ) : (
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Test history" className="min-h-0 overflow-auto rounded-lg border border-line bg-surface">
            <ul>
              {tests.map((test) => (
                <li key={test.id} className="border-b border-line-subtle last:border-b-0">
                  <button type="button" aria-current={test.id === currentId ? 'true' : undefined} onClick={() => setSelectedId(test.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-subtle ${test.id === currentId ? 'bg-brand-100/60' : ''}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-900">Inbox previews · v{test.template_version}</span>
                      <StatusBadge status={BADGE[test.status]} label={STATUS_LABEL[test.status]} />
                    </span>
                    <span className="text-xs text-ink-800">{formatDateTime(test.requested_at)}{test.requested_by ? ` · ${test.requested_by}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label="Test result" className="min-h-0 overflow-auto">
            {current === null ? null : <TestResult test={current} onZoom={setZoom} />}
          </section>
        </div>
      )}

      {zoom && (
        <Modal title={zoom.name} subtitle={[zoom.os, zoom.browser].filter(Boolean).join(' · ')} onClose={() => setZoom(null)} size="xl" scrollBody>
          <img src={zoom.screenshot || zoom.full_thumbnail || zoom.thumbnail} alt={`${zoom.name} render`} className="mx-auto block max-w-full" />
        </Modal>
      )}
    </div>
  )
}

function blockerFor({ allowance, savedVersion, readOnly }: { allowance: DeliverabilityAllowance; savedVersion: number; readOnly: boolean }) {
  if (!allowance.enabled) return { tone: 'warning' as const, text: 'Deliverability tests are not included in this workspace’s plan.', link: null }
  if (!allowance.configured) return { tone: 'info' as const, text: 'No inbox-preview account is set up yet.', link: { to: '/settings/delivery', label: 'Add the Mailgun Inspect account in Settings → Delivery.' } }
  if (readOnly) return { tone: 'info' as const, text: 'This template is read-only here; tests run from the template’s editor.', link: null }
  if (savedVersion === 0) return { tone: 'info' as const, text: 'Save the design once before testing: a test renders the saved version.', link: null }
  if (allowance.left === 0) return { tone: 'warning' as const, text: `This workspace has used its ${formatNumber(allowance.limit)} tests for the month. Testing resumes next month, or ask for a plan upgrade.`, link: null }
  return null
}

function AllowanceLine({ allowance }: { allowance: DeliverabilityAllowance }) {
  if (allowance.limit === null) return <p className="cep-num text-xs text-ink-800">{formatNumber(allowance.used)} tests this month · no limit</p>
  const spent = allowance.left === 0
  const near = !spent && allowance.left !== null && allowance.left <= Math.max(1, Math.ceil(allowance.limit * 0.1))
  return (
    <p className={`cep-num text-xs ${spent ? 'font-semibold text-danger-text' : near ? 'text-warning-text' : 'text-ink-800'}`} aria-label={`${allowance.used} of ${allowance.limit} tests used this month`}>
      {formatNumber(allowance.used)} of {formatNumber(allowance.limit)} tests used this month
    </p>
  )
}

function TestResult({ test, onZoom }: { test: DeliverabilityTest; onZoom: (preview: DeliverabilityPreview) => void }) {
  const running = test.status === 'PENDING' || test.status === 'PROCESSING'
  const groups = CATEGORY_ORDER.map((category) => ({ category, rows: test.previews.filter((p) => p.category === category) }))
    .concat([{ category: 'Other', rows: test.previews.filter((p) => !CATEGORY_ORDER.includes(p.category)) }])
    .filter((group) => group.rows.length > 0)
  const done = test.summary.complete ?? 0
  const failed = test.summary.failed ?? 0
  const total = test.summary.clients ?? test.previews.length

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SlotCard icon={Eye} title="Inbox Previews" state={test.status === 'FAILED' ? 'failed' : running ? 'running' : 'done'}
          line={running ? `Rendering in ${formatNumber(total)} clients` : `${formatNumber(done)} of ${formatNumber(total)} rendered${failed ? `, ${formatNumber(failed)} failed` : ''}`}
          note={test.status === 'FAILED' ? test.error ?? 'No client rendered the email.' : `Subject: ${test.subject ?? '(none)'}`} />
        <SlotCard icon={ShieldCheck} title="Spam Verdict" state="slot" line="Not in your plan" note="Mailgun Inspect Premium adds a spam check; the verdict will show here." />
        <SlotCard icon={Target} title="Inbox Placement" state="slot" line="Not available yet" note="Where the email lands at Gmail, Outlook and Yahoo will show here once a seed-list service is added." />
      </div>

      {running && test.previews.length === 0 && <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Waiting for the first render. This usually takes a minute or two.</p>}

      {groups.map((group) => (
        <section key={group.category} aria-label={CATEGORY_LABEL[group.category] ?? group.category}>
          <h3 className="mb-2 text-sm font-semibold text-ink-900">{CATEGORY_LABEL[group.category] ?? group.category} <span className="cep-num font-normal text-ink-800">· {group.rows.length}</span></h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {group.rows.map((preview) => <PreviewCard key={preview.id} preview={preview} onZoom={onZoom} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SlotCard({ icon: Icon, title, state, line, note }: { icon: typeof Eye; title: string; state: 'done' | 'running' | 'failed' | 'slot'; line: string; note: string }) {
  const tone = state === 'failed' ? 'text-danger-text' : state === 'slot' ? 'text-ink-300' : 'text-ink-900'
  return (
    <div className={`rounded-lg border border-line p-4 ${state === 'slot' ? 'border-dashed bg-surface-subtle' : 'bg-surface'}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-900"><Icon size={16} strokeWidth={1.5} aria-hidden className={state === 'slot' ? 'text-ink-300' : 'text-brand-600'} />{title}</p>
      <p className={`mt-2 text-sm font-medium ${tone}`}>{state === 'running' && <Spinner size="sm" className="mr-2 inline-block align-middle" />}{line}</p>
      <p className="mt-1 text-xs text-ink-800">{note}</p>
    </div>
  )
}

function PreviewCard({ preview, onZoom }: { preview: DeliverabilityPreview; onZoom: (preview: DeliverabilityPreview) => void }) {
  const meta = [preview.os, preview.browser].filter(Boolean).join(' · ')
  const image = preview.thumbnail || preview.full_thumbnail || preview.screenshot
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      {preview.status === 'COMPLETE' && image ? (
        <button type="button" onClick={() => onZoom(preview)} className="block w-full bg-surface-sunken" aria-label={`Open the ${preview.name} render`}>
          <img src={image} alt="" className="mx-auto block h-44 w-full object-cover object-top" loading="lazy" />
        </button>
      ) : (
        <div className="flex h-44 items-center justify-center bg-surface-sunken text-xs text-ink-800">
          {preview.status === 'FAILED' ? <span className="flex items-center gap-1 text-danger-text"><Inbox size={14} aria-hidden /> Did not render</span> : <span className="flex items-center gap-2"><Spinner size="sm" /> Rendering</span>}
        </div>
      )}
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium text-ink-900">{preview.name}</p>
        <p className="truncate text-xs text-ink-800">{preview.status === 'FAILED' && preview.detail ? preview.detail : meta || preview.category}</p>
      </div>
    </li>
  )
}
