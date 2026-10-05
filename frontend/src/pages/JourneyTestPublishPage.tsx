/** /journeys/:id/test-publish : Test Publish + Approve (phase 6i). Loads the journey, the version under test (its
 * newest DRAFT or TEST_PUBLISHED version) and that version's readiness checks, then hands everything to the
 * workspace, which owns the ready/sending/results/outcome state machine. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { EditorFailure, EditorLoading } from '@/features/designer/EditorStates'
import { JourneyTestPublishWorkspace } from '@/features/journeys/JourneyTestPublishWorkspace'
import { api } from '@/lib/api'
import type { Journey, JourneyReadiness, JourneyVersion, JourneyVersionDetail } from '@/lib/types'

function versionUnderTest(versions: JourneyVersion[]): number {
  const open = versions.filter((item) => item.status === 'DRAFT' || item.status === 'TEST_PUBLISHED')
  const pool = open.length > 0 ? open : versions
  return pool.reduce((max, item) => Math.max(max, item.version_number), 1)
}

export default function JourneyTestPublishPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()

  const journey = useQuery({ queryKey: ['journeys', 'detail', id], queryFn: ({ signal }) => api.get<Journey>(`/journeys/${id}/`, undefined, signal) })
  const versions = useQuery({ queryKey: ['journeys', 'versions', id], queryFn: ({ signal }) => api.get<JourneyVersion[]>(`/journeys/${id}/versions/`, undefined, signal) })
  const versionNumber = versions.data ? versionUnderTest(versions.data) : null
  const version = useQuery({
    queryKey: ['journeys', 'version', id, versionNumber],
    queryFn: ({ signal }) => api.get<JourneyVersionDetail>(`/journeys/${id}/versions/${versionNumber}/`, undefined, signal),
    enabled: versionNumber !== null,
  })
  const readiness = useQuery({
    queryKey: ['journeys', 'readiness', id, versionNumber],
    queryFn: ({ signal }) => api.get<JourneyReadiness>(`/journeys/${id}/versions/${versionNumber}/readiness/`, undefined, signal),
    enabled: versionNumber !== null,
  })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['journeys'] })
  }

  const failed = journey.isError ? journey : versions.isError ? versions : version.isError ? version : null
  if (failed) {
    return <EditorFailure title="Couldn’t load this journey" detail={failed.error instanceof Error ? failed.error.message : 'The server did not answer.'} onRetry={() => void failed.refetch()} />
  }
  if (!journey.data || !versions.data || versionNumber === null || !version.data) return <EditorLoading label="Opening Test Publish" />

  return (
    <JourneyTestPublishWorkspace
      key={`${id}-${versionNumber}`}
      journey={journey.data}
      version={version.data}
      readiness={readiness.data}
      readinessLoading={readiness.isLoading}
      onReadinessChanged={() => void queryClient.invalidateQueries({ queryKey: ['journeys', 'readiness', id, versionNumber] })}
      onApproved={refreshAll}
    />
  )
}
