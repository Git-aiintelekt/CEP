/**
 * Tag Check (docs/mockups/list-tag-values.html, option B's card): on a campaign's Audience and Review steps, for the people of the
 * chosen lists, how many have a value for each of the template's tags and where it comes from, in the order the send looks (the list
 * entry, the customer's attributes, the customer record). Fill From Database reads the missing ones from the attributes' databases for
 * these people and stores them with their list entries, in the background (needs list.edit).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Select, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SkeletonLine, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { AttributeRun, TagCheck } from '@/lib/types'

import { CardError, DetailCard } from '../campaigns/parts'

const FROM_WORD: Record<string, string> = { LIST: 'List column', ATTRIBUTE: 'Customer attribute', CUSTOMER: 'Customer record' }
const sameLists = (a: string[]) => [...a].sort().join(',')

function useTagCheck(template: string | null | undefined, include: string[], exclude: string[], enabled = true) {
  return useQuery({
    queryKey: ['customer-attributes', 'tag-check', template, sameLists(include), sameLists(exclude)],
    queryFn: () => api.post<TagCheck>('/customer-attributes/tag-check/', { template, include, exclude }),
    enabled: enabled && Boolean(template) && include.length > 0,
    staleTime: 30_000,
  })
}

function FillDialog({ check, include, exclude, campaignId, onClose }: { check: TagCheck; include: string[]; exclude: string[]; campaignId?: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const short = check.tags.filter((tag) => tag.missing > 0)
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(check.fillable.filter((item) => item.attribute).map((item) => [item.tag, item.attribute as string])))
  const [runId, setRunId] = useState('')
  const start = useMutation({
    mutationFn: () => api.post<AttributeRun>('/customer-attributes/fill/', { include, exclude, campaign: campaignId,
      tags: Object.entries(picked).filter(([, attribute]) => attribute).map(([tag, attribute]) => ({ tag, attribute })) }),
    onSuccess: (run) => setRunId(run.id),
  })
  const run = useQuery({
    queryKey: ['customer-attributes', 'run', runId],
    queryFn: ({ signal }) => api.get<AttributeRun>(`/customer-attributes/runs/${runId}/`, undefined, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data && ['DONE', 'FAILED'].includes(query.state.data.status) ? false : 2000),
  })
  const finished = run.data?.status === 'DONE'
  const read = run.data?.people_read ?? 0
  useEffect(() => {
    if (!finished) return
    void queryClient.invalidateQueries({ queryKey: ['customer-attributes', 'tag-check'] })
    toast.success('Tags filled', `${formatNumber(read)} people read; the Tag Check counts again.`)
    onClose()
  }, [finished, read, queryClient, toast, onClose])
  const chosen = Object.values(picked).filter(Boolean).length
  const working = Boolean(runId) && !finished && run.data?.status !== 'FAILED'

  return (
    <Modal title="Fill From Database" onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>{working ? 'Close, Keep Filling' : 'Cancel'}</button>
        {!runId && <button type="button" className={buttonPrimary} disabled={chosen === 0 || start.isPending} onClick={() => start.mutate()}>{start.isPending && <Spinner size="sm" tone="onBrand" />}Fill {chosen === 1 ? '1 Tag' : `${chosen} Tags`}</button>}
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-800">Reads the database for the {formatNumber(check.people)} people, by their ID, and stores the values with their list entries. Only entries without a value are filled.</p>
        {start.isError && <CardError what="the fill" error={start.error} onRetry={() => start.mutate()} />}
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[440px] text-left text-sm">
            <caption className="sr-only">Tags to fill and the attribute each is filled from</caption>
            <thead className="bg-surface-subtle text-xs font-semibold text-ink-900"><tr><th scope="col" className="px-3 py-2">Tag</th><th scope="col" className="px-3 py-2">Database Field</th></tr></thead>
            <tbody className="divide-y divide-line-subtle">
              {short.map((tag) => (
                <tr key={tag.key}>
                  <th scope="row" className="px-3 py-2 align-middle font-mono font-normal text-ink-900">{`{{${tag.key}}}`}</th>
                  <td className="px-3 py-2">
                    <Select aria-label={`Database field for {{${tag.key}}}`} className="mt-0!" value={picked[tag.key] ?? ''} disabled={Boolean(runId)}
                      onChange={(event) => setPicked((now) => ({ ...now, [tag.key]: event.target.value }))}>
                      <option value="">Do Not Fill</option>
                      {check.attributes.map((item) => <option key={item.key} value={item.key}>{item.source} · {item.field}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {check.attributes.length === 0 && <p className="text-helper text-ink-800">No customer attribute reads a Report Database yet. Add one under Settings → Customer Attributes.</p>}
        {runId ? (
          run.data?.status === 'FAILED'
            ? <p role="alert" className="text-sm text-danger-text">{run.data.error ?? 'The fill stopped.'}</p>
            : <p className="flex items-center gap-2 text-sm text-ink-900" aria-live="polite"><Spinner size="sm" />{run.data?.status === 'RUNNING' ? `Reading · ${formatNumber(run.data.people_read)} of ${formatNumber(check.people)} people` : 'Waiting to start'}</p>
        ) : (
          <p className="text-helper text-ink-800">Runs in the background; the Tag Check counts again when it ends. Lists used by other campaigns get the values too.</p>
        )}
      </div>
    </Modal>
  )
}

interface TagCheckCardProps {
  template: string | null | undefined
  include: string[]
  exclude: string[]
  campaignId?: string
  /** the Audience step, before the template is chosen: say where it comes from */
  showWithoutTemplate?: boolean
}

export function TagCheckCard({ template, include, exclude, campaignId, showWithoutTemplate = false }: TagCheckCardProps) {
  const auth = useOptionalAuth()
  const check = useTagCheck(template, include, exclude)
  const [details, setDetails] = useState(false)
  const [filling, setFilling] = useState(false)
  if (!template) {
    return showWithoutTemplate && include.length > 0 ? (
      <DetailCard title="Tag Check"><p className="text-sm text-ink-800">Choose the template on the Content step to see which of its tags have a value for these people.</p></DetailCard>
    ) : null
  }
  if (include.length === 0) return null
  if (check.isError) return <DetailCard title="Tag Check"><CardError what="the tag check" error={check.error} onRetry={() => void check.refetch()} /></DetailCard>
  if (!check.data) return <DetailCard title="Tag Check"><div aria-busy className="flex flex-col gap-3"><SkeletonLine width="60%" /><SkeletonLine width="90%" /></div></DetailCard>
  const data = check.data
  if (data.tags.length === 0) return null
  const fillable = data.fillable.some((item) => item.attribute) && (auth ? auth.can('list.edit') : true)
  const tag = data.short > 0 ? <Tag tone="warning">{data.short === 1 ? '1 Tag Short' : `${data.short} Tags Short`}</Tag> : <Tag tone="success">All Tags Have Values</Tag>
  const short = data.tags.filter((item) => item.missing > 0)

  if (data.short === 0 && !details) {
    return (
      <DetailCard title="Tag Check" tag={tag}>
        <p className="text-sm text-ink-800" data-tag-check>
          {data.tags.length === 1 ? '1 tag' : `${data.tags.length} tags`}, a value for all {formatNumber(data.people)} people.{' '}
          <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => setDetails(true)}>Details</button>
        </p>
      </DetailCard>
    )
  }
  return (
    <DetailCard title="Tag Check" tag={tag}>
      <div className={`flex flex-col gap-4 transition-opacity duration-base ${check.isFetching ? 'opacity-60' : ''}`} data-tag-check>
        <p className="text-helper text-ink-800">For the {formatNumber(data.people)} people in these lists{data.sampled ? ' (counted from a sample)' : ''}.</p>
        <table className="w-full text-sm">
          <caption className="sr-only">How many people have a value for each tag of {data.template.name}</caption>
          <thead><tr className="text-left text-helper text-ink-800"><th scope="col" className="font-semibold">Tag</th><th scope="col" className="whitespace-nowrap pl-2 text-right font-semibold">Has a Value</th><th scope="col" className="pl-3 font-semibold">From</th></tr></thead>
          <tbody>
            {data.tags.map((item) => (
              <tr key={item.key} className="border-t border-line-subtle align-top">
                <th scope="row" className="py-1.5 pr-2 text-left font-mono font-normal text-ink-900">{`{{${item.key}}}`}</th>
                <td className={`cep-num py-1.5 text-right ${item.missing > 0 ? 'font-semibold text-warning-text' : 'text-ink-900'}`}>{formatNumber(item.with_value)}</td>
                <td className="py-1.5 pl-3 text-ink-800">{item.from ? FROM_WORD[item.from] : 'Nowhere yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {short.length > 0 && (
          <ul className="flex flex-col gap-1 text-helper text-ink-800">
            {short.map((item) => (
              <li key={item.key}>
                {item.with_value === 0 ? 'Nobody has ' : `${formatNumber(item.missing)} ${item.missing === 1 ? 'person gets' : 'people get'} `}
                <span className="font-mono text-ink-900">{`{{${item.key}}}`}</span>
                {item.with_value === 0 ? `: everyone gets ${item.default ? `“${item.default}”` : 'nothing'}.` : `’s default${item.default ? ` “${item.default}”` : ', which is empty'}.`}
              </li>
            ))}
          </ul>
        )}
        {fillable && <div><Button size="sm" variant="secondary" onClick={() => setFilling(true)}>Fill From Database</Button></div>}
      </div>
      {filling && <FillDialog check={data} include={include} exclude={exclude} campaignId={campaignId} onClose={() => setFilling(false)} />}
    </DetailCard>
  )
}
