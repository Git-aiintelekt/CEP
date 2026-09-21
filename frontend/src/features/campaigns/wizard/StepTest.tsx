/** Step 6: see the message as a recipient would, then send a test to internal people. */
import { useAuth } from '@/auth/AuthContext'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { MessagePreview } from '../MessagePreview'
import { Panel } from '../parts'
import { TestPublishBox } from '../TestPublishBox'

export function StepTest({ campaign, options }: { campaign: Campaign; options: CampaignFormOptions | undefined }) {
  const { me } = useAuth()
  const tested = campaign.runs.some((run) => run.test_mode)
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Preview" description="With the catalogue's sample values, or as one customer of the audience would get it.">
        <MessagePreview campaignId={campaign.id} withCustomers={campaign.campaign_type !== 'E_RECEIPT'} />
      </Panel>
      <Panel title="Send a test" className="self-start" description={tested ? 'A test has been sent for this campaign. Send another one after every change to the content.' : undefined}>
        <TestPublishBox campaign={campaign} people={options?.owners ?? []} defaultTo={me?.principal.email ?? ''} />
      </Panel>
    </div>
  )
}
