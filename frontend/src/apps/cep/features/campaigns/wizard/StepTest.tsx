/** The Test step: the message as a recipient would get it (three quarters of the width; a click opens it large), and the test send beside it. */
import { useAuth } from '@/auth/AuthContext'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { MessagePreview } from '../MessagePreview'
import { Panel } from '../parts'
import { TestPublishBox } from '../TestPublishBox'
import { SubjectTestCard } from './SubjectTestCard'

export function StepTest({ campaign, options, onTested }: { campaign: Campaign; options: CampaignFormOptions | undefined; onTested?: () => void }) {
  const { me } = useAuth()
  const tested = campaign.runs.some((run) => run.test_mode)
  // a subject line test is for marketing email: a text has no subject, and a receipt goes to one person at a time.
  // A drip sets its test on one message (Sequence), never on the campaign: the API refuses the campaign's.
  const subjectTest = campaign.channel === 'EMAIL' && !['E_RECEIPT', 'DRIP'].includes(campaign.campaign_type) && !campaign.is_journey_generated
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]" data-test-step-layout>
      <div className="min-w-0 space-y-5">
        <Panel title="Preview" description="With the catalogue's sample values, or as one customer of the audience would get it. Click the message to see it large.">
          <MessagePreview campaignId={campaign.id} withCustomers={campaign.campaign_type !== 'E_RECEIPT'} enlarge />
        </Panel>
        {subjectTest && <SubjectTestCard key={campaign.id} campaign={campaign} />}
      </div>
      <Panel title="Send a Test" className="self-start" description={tested ? 'A test has been sent for this campaign. Send another one after every change to the content.' : undefined}>
        <TestPublishBox campaign={campaign} people={options?.owners ?? []} defaultTo={me?.principal.email ?? ''} onSent={onTested} />
      </Panel>
    </div>
  )
}
