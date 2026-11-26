/**
 * The upload's Tag Values step (docs/mockups/list-tag-values.html, option A): for each tag of a template, where each person's value
 * comes from: a column of the file, a customer attribute (read from its database for the file's people), the customer record, or the
 * tag's default. Opened from a campaign, the template is the campaign's; otherwise one can be chosen, or the step skipped: the file's
 * other columns are kept anyway, under their own names. The counts come with the check, on the Review step (TagValuesReview).
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'

import { Field, Select } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ListChannel, ListImport, Page, TagValueChoice, TagValueFrom, TagValueOptions, Template } from '@/lib/types'

const FROM: { value: TagValueFrom; label: string }[] = [
  { value: 'FILE', label: 'File Column' }, { value: 'ATTRIBUTE', label: 'Customer Attribute' }, { value: 'CUSTOMER', label: 'Customer Record' }, { value: 'DEFAULT', label: 'Default Value' },
]
const CHANNELS: Record<ListChannel, string[]> = { EMAIL: ['EMAIL'], SMS: ['SMS', 'MMS'], BOTH: ['EMAIL', 'SMS', 'MMS'] }

interface TagValuesStepProps {
  upload: ListImport
  mapping: Record<string, string>
  channel: ListChannel
  /** the campaign's template: chosen for the person, still changeable */
  campaignTemplate?: string
  template: string
  onTemplate: (template: string) => void
  choices: Record<string, TagValueChoice>
  onChoices: (choices: Record<string, TagValueChoice>) => void
}

export function TagValuesStep({ upload, mapping, channel, campaignTemplate, template, onTemplate, choices, onChoices }: TagValuesStepProps) {
  const captionId = useId()
  const templates = useQuery({
    queryKey: ['templates', 'options', 'tag-values'],
    queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal),
    staleTime: 60_000,
  })
  const options = useQuery({
    queryKey: ['contact-lists', 'tag-options', upload.id, template, JSON.stringify(mapping)],
    queryFn: () => api.post<TagValueOptions>(`/contact-lists/${upload.contact_list}/imports/${upload.id}/tag-options/`, { template_id: template, mapping }),
    enabled: Boolean(template),
    staleTime: 60_000,
  })
  // the first answer for each tag: what was chosen before, else what C360 suggests
  const seeded = useRef('')
  useEffect(() => {
    const data = options.data
    if (!data || seeded.current === `${template}:${data.tags.map((tag) => tag.key).join(',')}`) return
    seeded.current = `${template}:${data.tags.map((tag) => tag.key).join(',')}`
    onChoices(Object.fromEntries(data.tags.map((tag) => [tag.key, choices[tag.key] ?? tag.chosen ?? tag.suggested ?? { from: 'DEFAULT' }])))
  }, [options.data, template, choices, onChoices])

  const offered = (templates.data?.results ?? []).filter((item) => CHANNELS[channel].includes(item.channel) && item.status !== 'ARCHIVED')
  const data = options.data
  const columns = data?.columns ?? []
  const attributes = data?.attributes ?? []
  const set = (key: string, choice: TagValueChoice) => onChoices({ ...choices, [key]: choice })
  const pick = (key: string, from: TagValueFrom) => set(key, from === 'FILE' ? { from, column: columns[0]?.name } : from === 'ATTRIBUTE' ? { from, attribute: attributes[0]?.key } : { from })

  return (
    <div className="flex flex-col gap-4" data-tag-values-step>
      <Field label={campaignTemplate ? 'Template' : 'Check Against a Template'} strong
        hint={campaignTemplate ? 'The campaign’s template. Its tags get their values from here.' : 'Optional. Skip it and the file’s other columns are kept under their own names, ready for any template whose tags share them.'}>
        {(ids) => (
          <Select {...ids} value={template} onChange={(event) => { onTemplate(event.target.value); onChoices({}) }} disabled={templates.isPending}>
            <option value="">{templates.isPending ? 'Loading templates' : 'No Template: Skip This Step'}</option>
            {offered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {template && !offered.some((item) => item.id === template) && <option value={template}>{data?.template?.name ?? 'The campaign’s template'}</option>}
          </Select>
        )}
      </Field>

      {!template ? (
        <p className="text-sm text-ink-800">
          {columns.length || upload.columns.length ? `Columns the mapping does not use are kept with each list entry, lower case with underscores (“Store Name” becomes store_name).` : null}
        </p>
      ) : options.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Reading the template’s tags</p>
      ) : options.isError ? (
        <Notice tone="error" layout="banner"><p>The template’s tags could not be read. Choose the template again, or skip this step.</p></Notice>
      ) : data && data.tags.length === 0 ? (
        <Notice tone="info" layout="banner"><p>{data.template?.name ?? 'This template'} has no tag that changes from person to person. Nothing to choose: go on.</p></Notice>
      ) : data && (
        <>
          <p className="text-sm text-ink-800">
            {data.template?.name} uses {data.tags.length === 1 ? '1 tag' : `${formatNumber(data.tags.length)} tags`}. Choose where each person’s value comes from. A tag left on its default sends the same words to everyone.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-left text-sm" aria-describedby={captionId}>
              <caption id={captionId} className="sr-only">Where each tag of {data.template?.name} gets its value</caption>
              <thead className="bg-surface-subtle text-xs font-semibold text-ink-900">
                <tr>
                  <th scope="col" className="px-3 py-2">Tag</th>
                  <th scope="col" className="px-3 py-2">Value From</th>
                  <th scope="col" className="px-3 py-2">Field or Column</th>
                  <th scope="col" className="w-[180px] px-3 py-2">Sample (First Row)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {data.tags.map((tag) => {
                  const choice = choices[tag.key] ?? { from: 'DEFAULT' as const }
                  const column = columns.find((item) => item.name === choice.column)
                  const attribute = attributes.find((item) => item.key === choice.attribute)
                  return (
                    <tr key={tag.key} data-tag-row={tag.key}>
                      <th scope="row" className="px-3 py-2 align-top font-normal">
                        <span className="block font-mono text-ink-900">{`{{${tag.key}}}`}</span>
                        <span className="block text-helper text-ink-800">{tag.label}</span>
                      </th>
                      <td className="px-3 py-2 align-top">
                        <Select aria-label={`Value from, for {{${tag.key}}}`} value={choice.from} className="mt-0! min-w-[176px]" onChange={(event) => pick(tag.key, event.target.value as TagValueFrom)}>
                          {FROM.filter((item) => (item.value !== 'FILE' || columns.length > 0) && (item.value !== 'ATTRIBUTE' || attributes.length > 0)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {choice.from === 'FILE' ? (
                          <Select aria-label={`File column for {{${tag.key}}}`} value={choice.column ?? ''} className="mt-0! min-w-[176px]" onChange={(event) => set(tag.key, { from: 'FILE', column: event.target.value })}>
                            {columns.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                          </Select>
                        ) : choice.from === 'ATTRIBUTE' ? (
                          <Select aria-label={`Customer attribute for {{${tag.key}}}`} value={choice.attribute ?? ''} className="mt-0! min-w-[200px]" onChange={(event) => set(tag.key, { from: 'ATTRIBUTE', attribute: event.target.value })}>
                            {attributes.map((item) => <option key={item.key} value={item.key}>{item.source ? `${item.source} · ` : ''}{item.label}</option>)}
                          </Select>
                        ) : choice.from === 'CUSTOMER' ? (
                          <span className="font-mono text-helper text-ink-800">{tag.path ?? tag.key}</span>
                        ) : (
                          <span className="text-helper text-ink-800">{tag.default ? `“${tag.default}” for everyone` : 'Empty for everyone'}</span>
                        )}
                      </td>
                      <td className="w-[180px] px-3 py-2 align-middle text-helper text-ink-900">
                        {choice.from === 'FILE' ? (column?.sample || <span className="text-ink-800">—</span>)
                          : choice.from === 'ATTRIBUTE' ? <span className="text-helper text-ink-800">{attribute?.reads_database ? 'Read from the database when the file is checked' : 'The value C360 keeps'}</span>
                          : choice.from === 'CUSTOMER' ? <span className="text-helper text-ink-800">At send</span>
                          : <span className="text-ink-800">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-helper text-ink-800">How many people have a value comes with the check, before anything is saved. Values are kept with this list, so the campaign sends what you review.</p>
        </>
      )}
    </div>
  )
}

/** On the Review step: for the rows that can be imported, how many have a value for each tag, and what the others get */
export function TagValuesReview({ job }: { job: ListImport }) {
  const config = job.tag_values
  const result = config?.result
  if (!config || !result) return null
  if (result.error) return <Notice tone="warning" layout="banner" title="The tag values could not be read"><p>{result.error}</p></Notice>
  const tags = Object.entries(config.tags)
  if (!tags.length) return null
  const ready = result.ready ?? 0
  return (
    <section className="rounded-lg border border-line" aria-label="Tag Values" data-tag-values-review>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-subtle px-4 py-2.5">
        <p className="text-sm font-semibold text-ink-900">Tag Values</p>
        <p className="text-xs text-ink-800">{config.template_name} · of the {formatNumber(ready)} that can be imported</p>
      </div>
      <ul className="divide-y divide-line-subtle text-sm">
        {tags.map(([key, choice]) => {
          const found = result.tags?.[key]
          const count = found?.with_value ?? 0
          const short = choice.from !== 'DEFAULT' && choice.from !== 'CUSTOMER' && count < ready
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-ink-900">{`{{${key}}}`}</span>
                <Tag>{choice.from === 'FILE' ? choice.column ?? 'File' : choice.from === 'ATTRIBUTE' ? choice.attribute ?? 'Attribute' : choice.from === 'CUSTOMER' ? 'Customer Record' : 'Default'}</Tag>
                {found?.sample && <span className="truncate text-helper text-ink-800">{found.sample}</span>}
              </span>
              <span className={`cep-num font-medium ${short ? 'text-warning-text' : 'text-ink-900'}`}>
                {choice.from === 'DEFAULT' ? 'Default for everyone' : `${formatNumber(count)} of ${formatNumber(ready)}`}
              </span>
            </li>
          )
        })}
      </ul>
      {tags.some(([key, choice]) => choice.from !== 'DEFAULT' && choice.from !== 'CUSTOMER' && (result.tags?.[key]?.with_value ?? 0) < ready) && (
        <p className="border-t border-line-subtle px-4 py-2 text-helper text-ink-800">People without a value get the tag’s default at send.</p>
      )}
    </section>
  )
}
