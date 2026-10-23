/**
 * Insights → AI Reports (docs/mockups/ai-reports-page.html, option A): Ask for a Report on a page of its own, above Reports in the
 * menu, which offers it only when AI can draft reports for this person (GET /me insights.ai_reports). One column in the order of
 * the work: the box with an optional Report Name, Run Details, then Prompt History. The reports made here are ordinary reports:
 * listed under Reports with the AI mark, and placed on dashboards like any other.
 */
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useAssistant } from '../api'
import { AskForReport } from '../components/AskForReport'
import { PromptHistory } from '../components/PromptHistory'
import type { AssistantState } from '../types'

const WHY: Record<NonNullable<AssistantState['reason']>, string> = {
  no_right: 'Drafting reports with AI needs the report.edit permission. Ask a workspace administrator.',
  no_provider: 'No AI provider is switched on: the platform has none, and the workspace has not added its own key (Settings → AI Assistant).',
  workspace_off: 'AI is switched off for this workspace (Settings → AI Assistant).',
  no_provider_allowed: 'This workspace allows no AI provider (Settings → AI Assistant).',
}

export function AiReportsPage() {
  const state = useAssistant()
  const [seed, setSeed] = useState<{ prompt: string; at: number }>()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader help={<PageHelp chapter="insights" />} title="AI Reports"
        description="Describe a report, or attach its spec; the draft opens in the editor. The reports are listed under Reports and can go on any dashboard." />
      {state.isPending ? (
        <Spinner label="Loading" />
      ) : state.isError ? (
        <ErrorState error={state.error} onRetry={() => void state.refetch()} />
      ) : !state.data.enabled ? (
        <EmptyState icon={Sparkles} title="AI Reports is not available" hint={state.data.reason ? WHY[state.data.reason] : undefined}
          action={<Link to="/insights/reports" className="text-sm font-medium text-link hover:underline">Go to Reports</Link>} />
      ) : (
        <>
          <AskForReport seed={seed} />
          <PromptHistory onUse={(prompt) => setSeed({ prompt, at: Date.now() })} />
        </>
      )}
    </div>
  )
}
