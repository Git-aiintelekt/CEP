/**
 * /dev/list-lookup (dev builds only): New Contact List → Look Up in C360 on a stand-in API, so the whole flow can be walked through
 * without a backend: the databases and the role, the file of IDs, consent, the lookup running with its counter and time left, the
 * review, the import. ?databases=1 offers one database (no picker); ?rows= sets how many IDs the file holds (default 1,320,000).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { buttonPrimary } from '@/components/Form'
import { CreateListWizard } from '@/apps/cep/features/contact-lists/CreateListWizard'
import type { ContactList, ListImport, UploadSummary } from '@/lib/types'

const LOOKUP_SECONDS = 40
const SOURCES = [{ id: 'db-1', name: 'Citi-iCRM Prod', last_tested_at: '2026-11-24T08:00:00Z' }, { id: 'db-2', name: 'Citi-iCRM Archive', last_tested_at: '2026-11-20T08:00:00Z' }]
const ROLES = [{ key: 'CUSTOMER', label: 'Customer', id_label: 'Customer ID' }, { key: 'LEAD', label: 'Lead', id_label: 'Lead ID' },
  { key: 'ACCOUNT', label: 'Account', id_label: 'Account ID' }, { key: 'CONTACT', label: 'Account Primary Contact', id_label: 'Contact ID' }]

function summaryFor(rows: number, ready: number): UploadSummary {
  const sendable = Math.round(ready * 0.86)
  return {
    rows, held_back: { total: rows - ready, reasons: [{ code: 'LOOKUP', label: 'Left out by the lookup in C360', count: rows - ready - 880 }, { code: 'DUPLICATE_IN_FILE', label: 'The same person earlier in the file', count: 880 }] },
    ready: { total: ready, new: Math.round(ready * 0.09), existing: ready - Math.round(ready * 0.09) },
    governance: { sendable, not_sendable: ready - sendable, statuses: [{ code: 'MARKETABLE', label: 'Can receive marketing texts', sendable: true, count: sendable }, { code: 'NO_CONSENT', label: 'No consent', sendable: false, count: ready - sendable }] },
    mobile: { with_number: ready, blocked: 0 }, policy: { without_consent: 'HOLD_BACK', texts_need_date: false }, result: null, balanced: true, checked_at: '2026-11-24T10:00:00Z',
  } as UploadSummary
}

function install(rows: number) {
  const real = window.fetch.bind(window)
  let list: ContactList | null = null
  let job: ListImport | null = null
  let lookupFrom = 0
  let applyFrom = 0
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  const current = (): ListImport | null => {
    if (!job) return null
    const now = Date.now()
    if (job.lookup && !job.lookup.result && lookupFrom) {
      const share = Math.min(1, (now - lookupFrom) / (LOOKUP_SECONDS * 1000))
      if (share < 1) {
        job = { ...job, status: 'MATCHING', phase: 'Looking up in C360', working: true, row_count: rows, progress: { done: Math.round(rows * share), total: rows, percent: Math.min(99, Math.floor(share * 100)), unit: 'ids' } }
      } else {
        const usable = Math.round(rows * 0.8544)
        const held = [['Phone not open to solicitation', 0.0892], ['No primary phone', 0.0207], ['Customer ID not found', 0.0125], ['Not a Customer', 0.0092], ['Disabled in the source database', 0.0056], ['Number no longer in use', 0.0048]]
          .map(([reason, share_]) => ({ reason: String(reason), count: Math.round(rows * Number(share_)) }))
        const ready = usable - 880
        job = { ...job, status: 'REVIEW', phase: 'Checked. Review it to continue', working: false, mapping_confirmed: true, progress: { done: rows, total: rows, percent: 100, unit: 'rows' },
          lookup: { ...job.lookup, result: { ids: rows, found: Math.round(rows * 0.9875), usable, held, warnings: [{ reason: 'Customer not open to solicitation: imported with no text consent', count: Math.round(rows * 0.12) }],
            filled: { first_name: Math.round(usable * 0.99), mobile: usable, sms_consent_date: Math.round(usable * 0.86), email: Math.round(usable * 0.11), loyalty_id: Math.round(usable * 0.37), postal_code: Math.round(usable * 0.04), timezone: Math.round(usable * 0.04), consent_date: Math.round(usable * 0.08) },
            seconds: 220, finished_at: new Date().toISOString() } },
          review: { ready, held_back: rows - ready, new: Math.round(ready * 0.09), existing: ready - Math.round(ready * 0.09), warnings: Math.round(rows * 0.12), errors: rows - ready, duplicates: 880, rejected: rows - usable },
          summary: summaryFor(rows, ready), issues: [{ line: 14, kind: 'error', message: 'Customer ID not found', value: '10023469' }, { line: 31, kind: 'warning', message: 'Customer not open to solicitation: imported with no text consent', value: '10023486' }] }
      }
    }
    if (job.status === 'APPLYING' && now - applyFrom > 8000) {
      job = { ...job, status: 'APPLIED', phase: 'Imported', working: false, applied_count: job.review?.ready ?? 0, completed_at: new Date().toISOString() }
      if (list) list = { ...list, status: 'ACTIVE', member_count: job.applied_count }
    } else if (job.status === 'APPLYING') {
      const share = (now - applyFrom) / 8000
      job = { ...job, progress: { done: Math.round((job.review?.ready ?? 0) * share), total: job.review?.ready ?? 0, percent: Math.floor(share * 100), unit: 'rows' } }
    }
    return job
  }

  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
    const path = url.pathname
    const method = (init.method ?? 'GET').toUpperCase()
    if (!path.includes('/contact-lists/')) return path.startsWith('/api/') ? json({ type: 'about:blank', title: 'Not here', status: 404 }, 404) : real(input, init)
    if (path.endsWith('/contact-lists/lookup-sources/')) return json({ sources: SOURCES.slice(0, Number(new URLSearchParams(window.location.search).get('databases') ?? 2)), roles: ROLES })
    if (path.endsWith('/contact-lists/imports/')) return json(job ? [current()] : [])
    if (/\/contact-lists\/$/.test(path) && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, string>
      list = { id: 'cl-lookup', name: body.name, description: body.description, list_environment: body.list_environment, channel: body.channel, status: 'DRAFT', source_type: 'UPLOAD', member_count: 0 } as unknown as ContactList
      return json(list, 201)
    }
    if (path.endsWith('/imports/') && method === 'POST') {
      const form = init.body as FormData
      const role = String(form.get('lookup_role') ?? '')
      const picked = String(form.get('lookup_connections') ?? '').split(',')
      const idLabel = ROLES.find((item) => item.key === role)?.id_label ?? 'Party ID'
      lookupFrom = Date.now() + 1500
      job = { id: 'imp-lookup', contact_list: 'cl-lookup', list_name: list?.name ?? '', list_status: 'DRAFT', file_name: (form.get('file') as File).name, file_size: rows * 9, status: 'UPLOADED', phase: 'Reading the file',
        working: true, progress: { done: 0, total: rows * 9, percent: 0, unit: 'bytes' }, mapping_confirmed: false, error: null, created_at: new Date().toISOString(), completed_at: null, created_by_name: 'Aby John',
        row_count: rows, applied_count: 0, review: null, properties: [], columns: [{ name: idLabel, samples: ['10023456'], guess: null }], mapping: {}, list_channel: list?.channel,
        consent: { required: true, basis: null, basis_label: null, collected_at: null, attested_by_name: null, attested_at: null, attestation: 'I confirm these people agreed to receive marketing from Citi Trends',
          bases: [{ key: 'WEB_FORM', label: 'Signed up on our website or app', allowed: true }, { key: 'IN_STORE', label: 'Enrolled in store or in the loyalty programme', allowed: true },
            { key: 'CUSTOMER_REQUEST', label: 'Asked us directly', allowed: true }, { key: 'IMPLIED', label: 'Existing customers under implied consent', allowed: false }],
          policy: { without_consent: 'HOLD_BACK', texts_need_date: false, approval_before_send: false } },
        lookup: { databases: picked.map((id) => SOURCES.find((item) => item.id === id)?.name ?? id), role: role || null, role_label: ROLES.find((item) => item.key === role)?.label ?? null, id_label: idLabel, id_column: idLabel, result: null } }
      return json(job, 201)
    }
    if (job && path.endsWith('/consent/')) {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, string>
      job = { ...job, consent: { ...job.consent!, basis: body.basis as never, basis_label: body.basis, attested_by_name: 'Aby John', attested_at: new Date().toISOString() } }
      return json(current())
    }
    if (job && path.endsWith('/apply/')) {
      applyFrom = Date.now()
      job = { ...job, status: 'APPLYING', phase: 'Adding contacts to the list', working: true }
      return json(current(), 202)
    }
    if (job && /\/imports\/imp-lookup\/$/.test(path)) return json(current())
    if (list && /\/contact-lists\/cl-lookup\/$/.test(path)) return method === 'DELETE' ? Promise.resolve(new Response(null, { status: 204 })) : json(list)
    return json({ type: 'about:blank', title: 'Not here', status: 404 }, 404)
  }
}

let installed = false

export default function ListLookupPlayground() {
  const [params] = useSearchParams()
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [open, setOpen] = useState(true)
  if (!installed) {
    install(Number(params.get('rows') ?? 1_320_000))
    installed = true
  }
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-surface p-8">
        <p className="mb-4 text-sm text-ink-800">Look Up in C360 on a stand-in API. The lookup takes {LOOKUP_SECONDS} seconds here.</p>
        {!open && <button type="button" className={buttonPrimary} onClick={() => window.location.reload()}>Start Again</button>}
        {open && <CreateListWizard onClose={() => setOpen(false)} />}
      </div>
    </QueryClientProvider>
  )
}
