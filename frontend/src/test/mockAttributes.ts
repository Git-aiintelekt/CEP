/** Customer Attributes in the mock API: Settings → Customer Attributes and its Sources, the upload's Tag Values step and the Tag Check. */
import type { AttributeRun, ListImport, TagValueOptions } from '@/lib/types'

export { ATTRIBUTE_SOURCES, CUSTOMER_ATTRIBUTES, TAG_CHECK } from '@/apps/cep/features/attributes/sampleAttributes'

/** the tags of a template, as the Tag Values step offers them; t-promo is the sample SMS template with tags */
export function tagOptionsFor(templateId: string, job: ListImport): TagValueOptions {
  const mapped = new Set(Object.values(job.mapping ?? {}))
  const columns = job.columns.filter((column) => !mapped.has(column.name)).map((column) => ({ name: column.name, sample: column.samples[0] ?? '' }))
  if (!templateId) return { template: null, tags: [], columns, attributes: [] }
  const tags = templateId === 'tpl-none' ? [] : [
    { key: 'first_name', label: 'First Name', default: 'there', reads: 'CUSTOMER_MASTER', path: 'first_name', suggested: { from: 'CUSTOMER' as const }, chosen: null },
    { key: 'store_name', label: 'Store Name', default: 'your nearest store', reads: null, path: null,
      suggested: columns.length ? { from: 'FILE' as const, column: columns[0].name } : { from: 'DEFAULT' as const }, chosen: null },
    { key: 'points_balance', label: 'Points Balance', default: 'your', reads: 'CUSTOMER_ATTRIBUTE', path: 'points_balance', suggested: { from: 'ATTRIBUTE' as const, attribute: 'points_balance' }, chosen: null },
  ]
  return { template: { id: templateId, name: 'Black Friday Reminder', channel: 'SMS' }, tags, columns,
           attributes: [{ key: 'points_balance', label: 'Points Balance', source: 'CITI iCRM', kind: 'DATABASE', reads_database: true },
                        { key: 'last_online_order', label: 'Last Online Order', source: 'Shopify', kind: 'API', reads_database: false }] }
}

/** the check's counts for a job that answered the Tag Values step */
export function tagResultFor(job: ListImport): ListImport['tag_values'] {
  if (!job.tag_values) return job.tag_values ?? null
  const counts: Record<string, { with_value: number; sample: string | null }> = {}
  for (const [key, choice] of Object.entries(job.tag_values.tags)) {
    counts[key] = choice.from === 'DEFAULT' ? { with_value: 0, sample: null } : choice.from === 'ATTRIBUTE' ? { with_value: 3, sample: '1240' } : { with_value: 4, sample: 'Midtown' }
  }
  return { ...job.tag_values, result: { ready: 4, tags: counts } }
}

export const FILL_RUN: AttributeRun = { id: 'run-fill', trigger: 'FILL', trigger_label: 'Fill From Database', status: 'QUEUED', people_read: 0, people_matched: 0, values_changed: 0, error: null,
                                        queued_at: '2026-11-25T10:00:00Z', started_at: null, finished_at: null, params: {} }
