/** Connect a Database's two screens as state: the connection (tested, then saved) and the table or view a report reads. Shared by the drawer and Create Report. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { insightsApi, keys } from '../api'
import { connectionBody, connectionForm, testUsable, type ConnectionForm } from '../databaseConnection'
import { matches, PAGE } from '../sourceGroups'
import { starterDefinition } from '../starter'
import type { ReportDatabase, ReportDatabaseTest, ReportDataset, SourceList } from '../types'

export function useConnectionStep(onSaved: (database: ReportDatabase) => void) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ConnectionForm>(() => connectionForm(null))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [outcome, setOutcome] = useState<ReportDatabaseTest | null>(null)
  const [tested, setTested] = useState<string | null>(null)                    // the form as it was when the test passed
  const snapshot = JSON.stringify(form)
  const usable = Boolean(outcome && testUsable(outcome)) && tested === snapshot
  const test = useMutation({
    mutationFn: () => api.post<{ test: ReportDatabaseTest }>('/workspace/report-databases/test/', connectionBody(form, null)),
    onSuccess: ({ test: result }) => { setOutcome(result); setTested(snapshot); setErrors({}) },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { host: 'The connection was not tested.' }),
  })
  const save = useMutation({
    mutationFn: () => api.post<ReportDatabase>('/workspace/report-databases/', connectionBody(form, null)),
    onSuccess: (database) => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'report-databases'] })
      if (database.usable) onSaved(database)
      else if (database.test) { setOutcome(database.test); setTested(null) }
    },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { name: 'The database was not saved.' }),
  })
  const submit = (event?: FormEvent) => { event?.preventDefault(); if (usable) save.mutate() }
  return { form, setForm, errors, outcome, usable, retest: outcome !== null && !usable && tested === snapshot, test, save, submit }
}

export type ConnectionStep = ReturnType<typeof useConnectionStep>

/** database: null until one is connected (Create Report holds the hook from its first screen); naming: the report's name and
 * component as Create Report asked for them, the drawer names it after the dataset */
export function usePickSource(database: ReportDatabase | null, naming: { name?: string; component?: string | null } = {}) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const sources = useQuery({
    queryKey: ['workspace', 'report-database', database?.id ?? '', 'sources'],
    queryFn: ({ signal }) => api.get<SourceList>(`/workspace/report-databases/${database?.id}/sources/`, undefined, signal),
    enabled: Boolean(database),
  })
  const create = useMutation({
    mutationFn: async (source: string) => {
      if (!database) throw new Error('Connect the database first.')
      const dataset = await api.post<ReportDataset>(`/workspace/report-databases/${database.id}/datasets/`, { source })
      const catalog = await queryClient.fetchQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal), staleTime: 0 })
      const shape = catalog.datasets.find((d) => d.key === dataset.key)
      if (!shape) throw new Error('The new dataset is not in the catalogue yet. Try again in a moment.')
      return insightsApi.create({ name: naming.name?.trim() || `${dataset.label} report`, dataset: dataset.key, definition: starterDefinition(shape), ...(naming.component ? { component: naming.component } : {}) })
    },
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })
  const all = (sources.data?.sources ?? []).filter((s) => s.mappable && matches(s, search))
  const pinned = new Set(sources.data?.pinned ?? [])
  const found = [...all.filter((s) => pinned.has(s.name)), ...all.filter((s) => !pinned.has(s.name))].slice(0, shown)   // a 1,000-table database draws PAGE at a time
  return { database, search, setSearch: (next: string) => { setSearch(next); setShown(PAGE) }, chosen, setChosen, sources, create, all, found, more: () => setShown((n) => n + PAGE) }
}

export type PickSource = ReturnType<typeof usePickSource>
