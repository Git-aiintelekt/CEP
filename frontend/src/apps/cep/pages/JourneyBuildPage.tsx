/** /journeys/:id/build : the node-graph canvas (phase 6b). Loads the journey and its one draft version, and saves
 * the whole graph back with the version's row_version for the backend's optimistic lock.
 *
 * Coupon/Loyalty Tier pickers (features/journeys/NodeConfigPanel.tsx) call GET /coupons/ and GET /loyalty-tiers/,
 * which do not exist on the backend yet. Per the BRD, Coupon and LoyaltyTier are cached C360 references, meant to
 * get the same frontend-facing read treatment Segment already has (GET /contact-lists/audiences/, backed by
 * apps/contact_lists/lists.py's `audiences()`). A minimal, additive read endpoint of the same shape — id, code,
 * name, description/rank, is_active — would unblock those two pickers; this page was built frontend-only per this
 * task's scope and does not add it, so those pickers show a real "couldn't load" error until the backend adds one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { EditorFailure, EditorLoading } from '@/apps/cep/features/designer/EditorStates'
import { toWireGraph } from '@/apps/cep/features/journeys/graphModel'
import { JourneyBuildWorkspace, type SavePayload, type SetupSavePayload } from '@/apps/cep/features/journeys/JourneyBuildWorkspace'
import { api } from '@/lib/api'
import type { Journey, JourneyVersion, JourneyVersionDetail } from '@/lib/types'

function draftVersionNumber(versions: JourneyVersion[]): number {
  const draft = versions.find((item) => item.status === 'DRAFT')
  if (draft) return draft.version_number
  return versions.reduce((max, item) => Math.max(max, item.version_number), 1)
}

export default function JourneyBuildPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()

  const journey = useQuery({ queryKey: ['journeys', 'detail', id], queryFn: ({ signal }) => api.get<Journey>(`/journeys/${id}/`, undefined, signal) })
  const versions = useQuery({ queryKey: ['journeys', 'versions', id], queryFn: ({ signal }) => api.get<JourneyVersion[]>(`/journeys/${id}/versions/`, undefined, signal) })
  const versionNumber = versions.data ? draftVersionNumber(versions.data) : null
  // gcTime 0: always open the builder on the graph as stored now, never a cached copy from before someone else saved
  const version = useQuery({
    queryKey: ['journeys', 'version', id, versionNumber],
    queryFn: ({ signal }) => api.get<JourneyVersionDetail>(`/journeys/${id}/versions/${versionNumber}/`, undefined, signal),
    enabled: versionNumber !== null,
    gcTime: 0,
    staleTime: Infinity,
  })

  /** A published version can't change: its edits are saved as a new draft version (graph.new_version), which the builder
   * then moves onto. The live version keeps running until the new one is tested and approved. */
  const save = useMutation({
    mutationFn: async ({ row_version, entryRules, root }: SavePayload): Promise<JourneyVersionDetail> => {
      const graph = toWireGraph(root, entryRules)
      const published = version.data !== undefined && version.data.status !== 'DRAFT'
      const target = published
        ? await api.post<JourneyVersionDetail>(`/journeys/${id}/versions/`, { from_version: versionNumber })
        : { version_number: versionNumber, row_version }
      const saved = await api.put<JourneyVersionDetail>(`/journeys/${id}/versions/${target.version_number}/graph/`, { row_version: target.row_version, graph })
      queryClient.setQueryData(['journeys', 'version', id, saved.version_number], saved)
      void queryClient.invalidateQueries({ queryKey: ['journeys'], refetchType: 'none' })
      if (published) void queryClient.invalidateQueries({ queryKey: ['journeys', 'versions', id] })
      return saved
    },
  })

  /** Edit Setup. The journey's own fields are PATCHed; the entry rule goes onto a draft version's graph. A published
   * version can't change, so it is copied into a new draft first (POST .../versions/, graph.new_version) — customers
   * already enrolled stay on theirs — and population/re-entry are left alone: they live on the journey, not the
   * version, so changing them would change the live journey in place. Canvas edits not yet saved go along with the
   * entry rule; with none, the latest stored graph is read first so nobody's steps are overwritten. */
  const saveSetup = async ({ values, version: current, root, dirty }: SetupSavePayload): Promise<JourneyVersionDetail> => {
    const published = current.status !== 'DRAFT'
    const changes = published
      ? { name: values.name, description: values.description || null }
      : { name: values.name, description: values.description || null, population_mode: values.populationMode, reentry_policy: values.reentryPolicy, reentry_after_days: values.reentryAfterDays }
    const updated = await api.patch<Journey>(`/journeys/${id}/`, changes)
    queryClient.setQueryData(['journeys', 'detail', id], updated)

    const target = published
      ? await api.post<JourneyVersionDetail>(`/journeys/${id}/versions/`, { from_version: current.version_number })
      : dirty ? current : await api.get<JourneyVersionDetail>(`/journeys/${id}/versions/${current.version_number}/`)
    const base = dirty ? toWireGraph(root, current.graph.entry_rules) : target.graph
    const graph = { ...base, entry_rules: [values.rule, ...base.entry_rules.slice(1)] }
    try {
      const saved = await api.put<JourneyVersionDetail>(`/journeys/${id}/versions/${target.version_number}/graph/`, { row_version: target.row_version, graph })
      queryClient.setQueryData(['journeys', 'version', id, saved.version_number], saved)
      return saved
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['journeys'], refetchType: 'none' })
      // a new draft version: the builder moves onto it
      if (published) void queryClient.invalidateQueries({ queryKey: ['journeys', 'versions', id] })
    }
  }

  const failed = journey.isError ? journey : versions.isError ? versions : version.isError ? version : null
  if (failed) {
    return <EditorFailure title="Couldn’t load this journey" detail={failed.error instanceof Error ? failed.error.message : 'The server did not answer.'} onRetry={() => void failed.refetch()} />
  }
  if (!journey.data || !versions.data || versionNumber === null || !version.data) return <EditorLoading label="Opening the builder" />

  return (
    <JourneyBuildWorkspace
      key={`${id}-${versionNumber}`}
      journey={journey.data}
      version={version.data}
      saving={save.isPending}
      onSave={(payload) => save.mutateAsync(payload)}
      onSaveSetup={saveSetup}
    />
  )
}
