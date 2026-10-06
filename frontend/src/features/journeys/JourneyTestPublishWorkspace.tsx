/** Orchestrates the Test Publish + Approve page: test population, readiness, content preview, the ready/sending/
 * results side panel, Run Test's confirmation, and Approve's activate-now-or-schedule pop-up. Once the journey is
 * approved (or opens already ACTIVE / APPROVED with a schedule), the outcome screen replaces the whole body. */
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { useToast } from '@/components/Toast'
import { PageHelp } from '@/help/HelpPanel'
import { api } from '@/lib/api'
import { titleize } from '@/lib/format'
import type { Journey, JourneyGraphNode, JourneyReadiness, JourneyTestPopulation, JourneyTestResult, JourneyVersion, JourneyVersionDetail } from '@/lib/types'

import { ApproveModal } from './ApproveModal'
import { ContentPreviewCard } from './ContentPreviewCard'
import { JourneyOutcome } from './JourneyOutcome'
import { ReadinessCard } from './ReadinessCard'
import { RunTestModal } from './RunTestModal'
import { entrySummary } from './SettingsSidebar'
import { StageBar } from './StageBar'
import { TestPublishSidePanel } from './TestPublishSidePanel'
import { TestPopulationCard } from './TestPopulationCard'
import { activationText, populationText, useTestLists, type Outcome } from './testPublish'

interface WorkspaceProps {
  journey: Journey
  version: JourneyVersionDetail
  readiness: JourneyReadiness | undefined
  readinessLoading: boolean
  onReadinessChanged: () => void
  onApproved: () => void
}

const CHANNEL_ORDER = ['EMAIL', 'SMS', 'MMS']
const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS' }

function isLive(journey: Journey): boolean {
  return journey.status === 'ACTIVE' || journey.status === 'PAUSED'
}

/** A live journey opens on its new version's test when it has one (a draft or a tested version), else on the outcome. */
function initialOutcome(journey: Journey, version: JourneyVersion): Outcome | null {
  const live = isLive(journey)
  if (journey.scheduled_activate_at && (journey.status === 'APPROVED' || (live && journey.current_version === version.id))) {
    return { kind: 'SCHEDULED', when: activationText(new Date(journey.scheduled_activate_at)), version: live ? version.version_number : undefined }
  }
  const open = version.status === 'DRAFT' || version.status === 'TEST_PUBLISHED'
  if (live && !open) return { kind: 'ACTIVE', paused: journey.status === 'PAUSED' }
  return null
}

/** "Email · SMS": the channels the version's message steps use */
function channelsText(messageNodes: JourneyGraphNode[]): string {
  const used = CHANNEL_ORDER.filter((channel) => messageNodes.some((node) => node.type === channel))
  return used.length === 0 ? 'None' : used.map((channel) => CHANNEL_LABEL[channel]).join(' · ')
}

export function JourneyTestPublishWorkspace({ journey, version, readiness, readinessLoading, onReadinessChanged, onApproved }: WorkspaceProps) {
  const toast = useToast()
  const [population, setPopulation] = useState<JourneyTestPopulation>({ mode: 'RANDOM', sample_size: 50, contact_list_ids: [] })
  const [showRunModal, setShowRunModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [result, setResult] = useState<{ data: JourneyTestResult; at: string } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(() => initialOutcome(journey, version))
  const testLists = useTestLists()

  const runTest = useMutation({
    mutationFn: () => api.post<JourneyTestResult>(`/journeys/${journey.id}/versions/${version.version_number}/test-publish/`, population),
    onSuccess: (data) => {
      setResult({ data, at: new Date().toISOString() })
      setShowRunModal(false)
      onReadinessChanged()
    },
    onError: (error) => {
      setShowRunModal(false)
      toast.failure(error, 'The test was not sent')
    },
  })

  const approve = useMutation({
    mutationFn: (schedule: Date | null) => api.post<Journey>(`/journeys/${journey.id}/versions/${version.version_number}/approve/`, {
      schedule_at: schedule ? schedule.toISOString() : null,
    }),
    onSuccess: (updated, schedule) => {
      setShowApproveModal(false)
      const newVersion = isLive(journey) ? version.version_number : undefined
      setOutcome(schedule ? { kind: 'SCHEDULED', when: activationText(schedule), version: newVersion }
                          : { kind: 'ACTIVE', version: newVersion, paused: updated.status === 'PAUSED' })
      onApproved()
      toast.success(newVersion ? (schedule ? `Version ${newVersion} scheduled` : `Version ${newVersion} approved`) : schedule ? 'Journey scheduled' : 'Journey activated', updated.name)
    },
    onError: (error) => {
      toast.failure(error, 'The journey was not approved')
    },
  })

  const messageNodes = version.graph.nodes.filter((node) => node.type === 'EMAIL' || node.type === 'SMS' || node.type === 'MMS')
  const entryRules = version.graph.entry_rules
  const entryLabel = entryRules.length === 0 ? 'Not set' : entryRules.map(entrySummary).join('; ')
  const canRun = Boolean(readiness?.ready) && !runTest.isPending
  const checks = readiness ? { passed: readiness.items.filter((item) => item.ok).length, total: readiness.items.length } : null
  const governancePassed = readiness?.items.find((item) => item.key === 'governance')?.ok ?? false
  const populationLabel = populationText(population, testLists.data?.results)
  const channels = channelsText(messageNodes)

  const panelState: 'ready' | 'sending' | 'results' = runTest.isPending ? 'sending' : result ? 'results' : 'ready'

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <StageBar
        journeyName={journey.name}
        stage="test-publish"
        testDone={Boolean(result) || outcome !== null}
        approveState={outcome?.kind === 'ACTIVE' ? 'done' : outcome?.kind === 'SCHEDULED' ? 'scheduled' : undefined}
        live={outcome?.kind === 'ACTIVE'}
        actions={
          <Link to={`/journeys/${journey.id}/build`} className={`${buttonSecondary} max-sm:w-10 max-sm:px-0`}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> <span className="max-sm:sr-only">Back to Build</span>
          </Link>
        }
      />
      {outcome ? (
        <JourneyOutcome journeyId={journey.id} outcome={outcome} />
      ) : (
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">
          <span className="flex items-center gap-1.5"><h1 className="font-display text-page-title font-semibold text-ink-900">Test Publish</h1><PageHelp chapter="journeys" /></span>
          <p className={`mt-1 text-sm text-ink-800 ${isLive(journey) ? 'mb-4' : 'mb-6'}`}>Run this Journey on a small population before approving it for live automation.</p>
          {isLive(journey) && (
            <div className="mb-6">
              <Notice tone="info" layout="banner">
                You are testing version {version.version_number} of a {journey.status === 'PAUSED' ? 'paused' : 'live'} journey. The live version keeps running meanwhile;
                once this one is approved, new customers enter it and customers already inside finish the version they started.
              </Notice>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-6">
              <TestPopulationCard value={population} onChange={setPopulation} />
              <ReadinessCard readiness={readiness} loading={readinessLoading} />
              <ContentPreviewCard messageNodes={messageNodes} />
            </div>
            <TestPublishSidePanel
              state={panelState}
              canRun={canRun}
              checks={readinessLoading ? null : checks}
              populationText={populationLabel}
              channelsText={channels}
              result={result?.data ?? null}
              resultAt={result?.at ?? null}
              onRunTest={() => setShowRunModal(true)}
              onApprove={() => setShowApproveModal(true)}
              onRunAgain={() => setResult(null)}
            />
          </div>
        </div>
      )}

      {showRunModal && (
        <RunTestModal
          sending={runTest.isPending}
          populationText={populationLabel}
          channelsText={channels}
          governancePassed={governancePassed}
          onCancel={() => setShowRunModal(false)}
          onConfirm={() => runTest.mutate()}
        />
      )}
      {showApproveModal && result && (
        <ApproveModal
          testResult={result.data}
          populationModeLabel={titleize(journey.population_mode)}
          entryLabel={entryLabel}
          submitting={approve.isPending}
          onCancel={() => setShowApproveModal(false)}
          onConfirm={(schedule) => approve.mutate(schedule)}
        />
      )}
    </div>
  )
}
