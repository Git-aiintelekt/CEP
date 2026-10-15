/**
 * Who one drip message left out, by reason (its run's skipped.by_reason), in the Audience tab's words. View People lists
 * them one by one inside the drawer (GET /campaign-runs/{id}/skipped/): name, address and reason, with search, a reason
 * filter and pages.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/Button'
import { Drawer } from '@/components/Drawer'
import { Field, Select, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { buttonClass } from '@/components/buttonStyles'
import { exclusionReason } from '@/apps/cep/features/delivery/exclusionReasons'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { DripStep, RunSkippedPage } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const PAGE_SIZE = 25

export function SkippedDrawer({ step, channel, onClose }: { step: DripStep; channel: string; onClose: () => void }) {
  const skipped = step.run?.skipped ?? { total: 0, by_reason: [] }
  const [people, setPeople] = useState(false)
  return (
    <Drawer title={`Skipped for Message ${step.position}`} eyebrow={step.name || 'Untitled Message'} onClose={onClose}
      footer={<>
        {people
          ? <Button variant="secondary" iconStart={ChevronLeft} onClick={() => setPeople(false)}>Back to Reasons</Button>
          : step.run && skipped.total > 0 && <Button variant="secondary" onClick={() => setPeople(true)}>View People</Button>}
        <span className="flex-1" />
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      {people && step.run ? <SkippedPeople runId={step.run.id} position={step.position} channel={channel} /> : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-pretty text-ink-800">Skipped people stay in the drip and get later messages if they're eligible then. Unsubscribed people get nothing more.</p>
          <div className="overflow-x-auto"><table className="w-full text-sm" aria-label={`Skipped for message ${step.position}`}>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold text-ink-900">
                <th scope="col" className="py-2 pr-4 font-semibold">Reason</th>
                <th scope="col" className="py-2 text-right font-semibold">People</th>
              </tr>
            </thead>
            <tbody>
              {skipped.by_reason.map((item) => (
                <tr key={item.reason} className="border-b border-line-subtle">
                  <td className="py-2.5 pr-4 text-ink-900">{exclusionReason(item.reason, channel)}</td>
                  <td className="cep-num py-2.5 text-right text-ink-900">{formatNumber(item.count)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="py-2.5 pr-4 text-left font-semibold text-ink-900">Total Skipped</th>
                <td className="cep-num py-2.5 text-right font-semibold text-ink-900">{formatNumber(skipped.total)}</td>
              </tr>
            </tfoot>
          </table></div>
        </div>
      )}
    </Drawer>
  )
}

function SkippedPeople({ runId, position, channel }: { runId: string; position: number; channel: string }) {
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebouncedValue(search.trim(), 300)
  const list = useQuery({
    queryKey: ['campaign-runs', runId, 'skipped', { reason, q, page }],
    queryFn: ({ signal }) => api.get<RunSkippedPage>(`/campaign-runs/${runId}/skipped/`, { reason: reason || undefined, q: q || undefined, page, page_size: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1
  const texts = channel === 'SMS' || channel === 'MMS'

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Field label="Search">
          {(ids) => <TextInput {...ids} controlSize="sm" type="search" value={search} placeholder={texts ? 'Name, number or customer ID' : 'Name, address or customer ID'}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }} />}
        </Field>
        <Field label="Reason">
          {(ids) => (
            <Select {...ids} controlSize="sm" value={reason} onChange={(event) => { setReason(event.target.value); setPage(1) }}>
              <option value="">All Reasons</option>
              {Object.entries(data?.by_reason ?? {}).map(([code, count]) => <option key={code} value={code}>{`${exclusionReason(code, channel)} (${formatNumber(count)})`}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      : !data ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
      : data.count === 0 ? <p className="text-sm text-ink-800">{reason || q ? 'Nobody matches these filters.' : 'Nobody was skipped.'}</p>
      : (
        <>
          <ul aria-label={`People skipped for message ${position}`} className="flex flex-col divide-y divide-line-subtle border-y border-line-subtle">
            {data.results.map((person) => {
              const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || person.party_id
              return (
                <li key={person.party_id} className="flex flex-col gap-0.5 py-2.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-ink-900">{name}</span>
                    <span className="shrink-0 text-xs text-ink-800">{exclusionReason(person.reason, channel)}</span>
                  </span>
                  <span className="truncate text-xs text-ink-800">{person.address ?? `Customer ${person.party_id}`}</span>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-800">
            <span className="cep-num">{formatNumber(data.count)} {data.count === 1 ? 'person' : 'people'} · page {data.page} of {pages}</span>
            <span className="flex gap-2">
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
