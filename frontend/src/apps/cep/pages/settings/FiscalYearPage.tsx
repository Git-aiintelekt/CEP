/**
 * Settings → Fiscal Year: the month the workspace's fiscal year starts in, and whether a fiscal year is named by the year it
 * ends in (FY2027 for April 2026 to March 2027) or starts in. Reports group by fiscal quarter and year with it, filter on this
 * or last fiscal quarter or year, and count year and quarter to date from its start; dashboards offer it as a period.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Field, Select } from '@/components/Form'
import { SaveTick } from '@/components/SaveTick'
import { ErrorState, Spinner } from '@/components/States'
import { fiscalKey, useFiscalYear } from '@/apps/insights/api'
import { fiscalExample, MONTHS } from '@/apps/insights/components/fiscal'
import type { FiscalYear } from '@/apps/insights/types'
import { api } from '@/lib/api'

export function FiscalYearPage() {
  const queryClient = useQueryClient()
  const year = useFiscalYear()
  const save = useMutation({
    mutationFn: (body: Partial<FiscalYear>) => api.put<FiscalYear>('/workspace/fiscal-year/', { ...(year.data ?? { start: 1, named_by: 'end' }), ...body }),
    onSuccess: (next) => { queryClient.setQueryData(fiscalKey, next); void queryClient.invalidateQueries({ queryKey: ['insights', 'catalog'] }) },
  })

  if (year.isError) return <ErrorState title="The fiscal year could not be loaded" error={year.error} onRetry={() => void year.refetch()} />
  if (year.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = year.data

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Fiscal Year</h2>
        <p className="mt-0.5 text-sm text-ink-800">When your year starts. Reports can group by fiscal quarter and year, filter on this or last fiscal quarter or year, and count year to date from its first day.</p>
      </div>
      <section className="max-w-3xl rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts In">
            {({ id, describedBy }) => (
              <span className="flex items-center gap-3">
                <Select id={id} describedBy={describedBy} value={String(data.start)} disabled={save.isPending} onChange={(event) => save.mutate({ start: Number(event.target.value) })}>
                  {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </Select>
                <SaveTick mutation={save} field="start" />
              </span>
            )}
          </Field>
          <Field label="Name a Fiscal Year By" hint="FY2027 is the year that ends in 2027, or the one that starts in it.">
            {({ id, describedBy }) => (
              <span className="flex items-center gap-3">
                <Select id={id} describedBy={describedBy} value={data.named_by} disabled={save.isPending || data.start === 1} onChange={(event) => save.mutate({ named_by: event.target.value as FiscalYear['named_by'] })}>
                  <option value="end">The Year It Ends In</option>
                  <option value="start">The Year It Starts In</option>
                </Select>
                <SaveTick mutation={save} field="named_by" />
              </span>
            )}
          </Field>
        </div>
        <p className="mt-4 text-sm text-ink-900" aria-live="polite">{data.start === 1 ? 'Your fiscal year is the calendar year.' : fiscalExample(data)}</p>
        {save.isError && <div className="mt-3"><ErrorState title="The fiscal year was not changed" error={save.error} /></div>}
      </section>
    </div>
  )
}
