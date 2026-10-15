/**
 * New Report, the first step: pick a dataset, grouped by component. The report is created with the dataset's first
 * columns (its dimensions, then its measures totalled) and opened in the viewer; the editor (the option still to be
 * chosen from docs/mockups/report-builder.html) takes it from there.
 */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { insightsApi, useCatalog } from '../api'
import { starterDefinition } from '../starter'
import type { CatalogDataset } from '../types'

export function NewReportPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const catalog = useCatalog()
  const toast = useToast()
  const [dataset, setDataset] = useState<string>('')
  const [name, setName] = useState('')
  const datasets = (catalog.data?.datasets ?? []).filter((d) => !params.get('component') || d.component.key === params.get('component'))
  const chosen = datasets.find((d) => d.key === dataset) ?? null
  const create = useMutation({
    mutationFn: () => insightsApi.create({ name: name.trim() || `${chosen?.label} report`, dataset, definition: starterDefinition(chosen as CatalogDataset) }),
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`, { replace: true }),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="New Report" description="Pick what to report on. The report opens in the editor with the dataset's first columns." />
      {catalog.isPending ? <Spinner label="Loading the datasets" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); if (chosen) create.mutate() }}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900">Dataset</legend>
            {Array.from(new Map(datasets.map((d) => [d.component.key, d.component])).values()).map((component) => (
              <div key={component.key} className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{component.name}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {datasets.filter((d) => d.component.key === component.key).map((d) => (
                    <label key={d.key} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${dataset === d.key ? 'border-brand-600 bg-brand-100/40' : 'border-line bg-surface hover:bg-surface-hover'}`}>
                      <input type="radio" name="dataset" value={d.key} checked={dataset === d.key} onChange={() => setDataset(d.key)} className="mt-1" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">{d.label}</span>
                        <span className="block text-xs text-ink-800">{d.description}</span>
                        <span className="mt-1 block text-xs text-ink-700">{d.fields.filter((f) => f.role === 'dimension').length} dimensions · {d.fields.filter((f) => f.role === 'measure').length} measures</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <Field label="Name" hint="You can rename it later.">
            {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={name} onChange={(event) => setName(event.target.value)} placeholder={chosen ? `${chosen.label} report` : 'Pick a dataset first'} maxLength={200} />}
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonPrimary} disabled={!chosen || create.isPending}>Create Report</button>
            <button type="button" className={buttonSecondary} onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
