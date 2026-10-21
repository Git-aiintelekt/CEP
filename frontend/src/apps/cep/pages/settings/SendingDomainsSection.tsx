/** Settings → Delivery → Sending Domains: the DNS records inboxes read before they trust mail from this workspace's domains
 * (SPF, DMARC and, once the engine's selector is given, DKIM), one row per domain its email senders use. Each problem opens to
 * the record found and the record to publish. C360 looks them up daily and on Check Now, and never changes DNS. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonSecondary, TextInput } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { DnsCheck, DnsStatus, SendingDomain, SendingDomains } from '@/lib/types'

import { DOMAINS, useSendingDomains } from './sendingDomains'

const TAG: Record<DnsStatus, { status: string; label: string }> = {
  PASS: { status: 'PASSES', label: 'Passes' },
  MISSING: { status: 'FAILED', label: 'Missing' },
  MULTIPLE: { status: 'FAILED', label: 'Two Records' },
  ANY: { status: 'FAILED', label: 'Lets Anyone Send' },
  MONITOR: { status: 'PAUSED', label: 'Monitor Only' },
  NOT_CHECKED: { status: 'NEUTRAL', label: 'Not Checked' },
}

const WHY: Record<'spf' | 'dmarc' | 'dkim', Partial<Record<DnsStatus, string>>> = {
  spf: {
    PASS: 'Names the servers allowed to send for this domain.',
    MISSING: 'Inboxes cannot tell which servers may send for this domain, so its mail is filtered more often and is easier to forge.',
    MULTIPLE: 'Two or more SPF records make the check fail outright. Merge them into one record that names every service that sends for you.',
    ANY: 'The record ends in +all, so every server on the internet passes. End it with ~all instead.',
  },
  dmarc: {
    PASS: 'Inboxes quarantine or refuse mail in this name that fails SPF and DKIM.',
    MISSING: 'Nothing tells inboxes what to do with mail that fails SPF and DKIM, so forged mail in this name is delivered. Start with quarantine; daily reports go to the address in rua.',
    MONITOR: 'The policy is p=none: reports arrive, but forged mail in this name is still delivered. Move to quarantine once the reports look right.',
  },
  dkim: {
    PASS: 'The engine’s signing key is published, so inboxes can tell a message was not changed on the way.',
    MISSING: 'No key at this name. Copy the DKIM record from your engine’s DNS page, or check the selector.',
    NOT_CHECKED: 'DKIM signs each message so inboxes can tell it was not changed on the way. Its record name includes your engine’s selector: Postal shows it on the domain’s DNS page.',
  },
}

function DnsTag({ check }: { check: DnsCheck | undefined }) {
  const tag = check?.status ? TAG[check.status] : null
  return tag ? <StatusBadge status={tag.status} label={tag.label} /> : <StatusBadge status="NEUTRAL" label="Not Checked" />
}

function CopyButton({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className={buttonSecondary} aria-label={`Copy ${name}`}
      onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
  )
}

function DnsLine({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <span className="text-ink-800">{label}</span>
      <code className={`font-mono overflow-hidden rounded-sm border border-line-subtle bg-surface px-2 py-1.5 text-xs [overflow-wrap:anywhere] ${copy ? 'text-ink-900' : 'text-ink-800'}`}>{value}</code>
      {copy ? <CopyButton value={value} name={copy} /> : <span />}
    </div>
  )
}

function Record({ title, part, check, domain, children }: { title: string; part: 'spf' | 'dmarc' | 'dkim'; check: DnsCheck; domain: string; children?: ReactNode }) {
  const status = check.status ?? 'NOT_CHECKED'
  const name = check.name ?? domain
  return (
    <div className="grid gap-x-4 gap-y-2 border-t border-line-subtle pt-3 first:border-t-0 first:pt-0 md:grid-cols-[120px_minmax(0,1fr)]">
      <div className="flex items-center gap-2 md:flex-col md:items-start"><span className="text-sm font-semibold text-ink-900">{title}</span><DnsTag check={check} /></div>
      <div className="grid min-w-0 gap-2">
        <p className="max-w-3xl text-sm text-ink-800">{WHY[part][status] ?? ''}</p>
        {part !== 'dkim' || status !== 'NOT_CHECKED' ? (
          <>
            {status !== 'PASS' && <DnsLine label="Found" value={check.found.length ? check.found.join('  |  ') : `No record at ${name}`} />}
            {status === 'PASS' && check.found[0] && <DnsLine label="Published" value={check.found[0]} />}
            {check.publish && part === 'dmarc' && <DnsLine label="Name" value={name} copy={`${title} record name`} />}
            {check.publish && <DnsLine label="Value (TXT)" value={check.publish} copy={`${title} record value`} />}
          </>
        ) : null}
        {children}
      </div>
    </div>
  )
}

function SelectorForm({ row }: { row: SendingDomain }) {
  const queryClient = useQueryClient()
  const [selector, setSelector] = useState(row.dkim_selector ?? '')
  const save = useMutation({
    mutationFn: () => api.post<SendingDomains>('/sending-domains/selector/', { domain: row.domain, selector }),
    onSuccess: (data) => queryClient.setQueryData(DOMAINS, data),
  })
  const error = save.error instanceof ApiError ? (save.error.fieldErrors.selector ?? save.error.message) : save.error ? 'The selector was not saved.' : null
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate() }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`selector-${row.domain}`} className="text-sm font-medium text-ink-900">Selector</label>
      <div className="w-56">
        <TextInput id={`selector-${row.domain}`} value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="e.g. postal-Xa71Qd"
          className="font-mono" controlSize="sm" invalid={Boolean(error)} />
      </div>
      <button type="submit" className={buttonSecondary} disabled={save.isPending || selector === (row.dkim_selector ?? '')}>{save.isPending ? 'Checking' : 'Save and Check'}</button>
      {error && <p role="alert" className="w-full text-xs text-danger-text">{error}</p>}
    </form>
  )
}

function Records({ row }: { row: SendingDomain }) {
  const result = row.result
  if (!result) return <p className="text-sm text-ink-800">Not looked up yet: press Check Now, or wait for the daily check.</p>
  if (result.lookup === 'EXAMPLE') return <p className="text-sm text-ink-800">{row.domain} is reserved for examples, so it is not looked up. Real mail needs a domain you own.</p>
  if (result.lookup === 'NO_ANSWER') return <p className="text-sm text-ink-800">DNS did not answer for {row.domain} when C360 looked it up. Check Now again in a few minutes.</p>
  return (
    <div className="grid gap-3">
      <Record title="SPF" part="spf" check={result.spf} domain={row.domain} />
      <Record title="DMARC" part="dmarc" check={result.dmarc} domain={row.domain} />
      <Record title="DKIM" part="dkim" check={result.dkim} domain={row.domain}>
        {result.dkim.status === 'PASS' && result.dkim.name && <p className="text-xs text-ink-800">Read at {result.dkim.name}.</p>}
        <SelectorForm row={row} />
      </Record>
    </div>
  )
}

function summary(row: SendingDomain): string {
  const result = row.result
  if (!result) return 'Not looked up yet'
  if (result.lookup === 'EXAMPLE') return 'Example domain, not looked up'
  if (result.lookup === 'NO_ANSWER') return 'DNS did not answer'
  return result.changes ? `${result.changes} change${result.changes === 1 ? '' : 's'} to make` : 'Nothing to change'
}

export function SendingDomainsSection({ onNotice }: { onNotice: (notice: { ok: boolean; text: string }) => void }) {
  const queryClient = useQueryClient()
  const domains = useSendingDomains()
  const check = useMutation({
    mutationFn: () => api.post<SendingDomains>('/sending-domains/check/'),
    onSuccess: (data) => {
      queryClient.setQueryData(DOMAINS, data)
      const changes = data.domains.reduce((sum, row) => sum + (row.result?.changes ?? 0), 0)
      onNotice({ ok: true, text: changes ? `Sending domains looked up: ${changes} DNS change${changes === 1 ? '' : 's'} to make.` : 'Sending domains looked up: nothing to change.' })
    },
    onError: (error) => onNotice({ ok: false, text: error instanceof ApiError ? error.message : 'The domains were not looked up.' }),
  })
  const rows = domains.data?.domains ?? []
  const columns: Column<SendingDomain>[] = [
    { key: 'domain', header: 'Domain', render: (row) => <div><p className="font-medium text-ink-900">{row.domain}</p><p className="text-xs text-ink-800">{summary(row)}</p></div> },
    { key: 'used', header: 'Used By', render: (row) => <span className="cep-num" title={row.senders.map((s) => s.from_address).join(', ')}>{row.senders.length} sender{row.senders.length === 1 ? '' : 's'}</span> },
    { key: 'spf', header: 'SPF', render: (row) => <DnsTag check={row.result?.lookup === 'OK' ? row.result.spf : undefined} /> },
    { key: 'dmarc', header: 'DMARC', render: (row) => <DnsTag check={row.result?.lookup === 'OK' ? row.result.dmarc : undefined} /> },
    { key: 'dkim', header: 'DKIM', render: (row) => <DnsTag check={row.result?.lookup === 'OK' ? row.result.dkim : undefined} /> },
  ]
  const open = rows.filter((row) => (row.result?.changes ?? 0) > 0).slice(0, 1).map((row) => row.domain)

  return (
    <section aria-labelledby="domains-heading" id="sending-domains">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="domains-heading" className="font-display text-section-title font-semibold text-ink-900">Sending Domains</h2>
          <p className="text-sm text-ink-800">The DNS records inboxes read before they trust mail from your domains. Publish the records at your DNS provider; C360 looks them up daily and never changes them.</p>
        </div>
        {rows.length > 0 && domains.data?.ready && (
          <div className="flex items-center gap-3">
            {domains.data?.checked_at && <span className="text-sm text-ink-800">Checked {formatDateTime(domains.data.checked_at)}</span>}
            <button type="button" className={buttonSecondary} disabled={check.isPending} onClick={() => check.mutate()}>
              <RefreshCw size={16} strokeWidth={1.5} aria-hidden className={check.isPending ? 'animate-spin' : ''} />{check.isPending ? 'Checking' : 'Check Now'}
            </button>
          </div>
        )}
      </div>
      {domains.isError ? <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
        : domains.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading domains</p>
        : rows.length === 0 ? <EmptyState title="No email domain to check yet" hint="Add an email sender above; its domain is looked up the same day." />
        : !domains.data.ready ? <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-800">Domain checks are not switched on here yet. {rows.length} domain{rows.length === 1 ? '' : 's'} will be looked up once they are: {rows.map((row) => row.domain).join(', ')}.</p>
        : <DataTable columns={columns} rows={rows} rowKey={(row) => row.domain} caption="Sending Domains"
            expand={{ label: (row) => `Records for ${row.domain}`, render: (row) => <Records row={row} />, initiallyOpen: open }} />}
    </section>
  )
}

