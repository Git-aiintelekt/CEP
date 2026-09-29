/**
 * Content: the message full size (as the samples or one customer would get it), what it is made of, and a test send.
 * The customer and the device are chosen in the Message card's header.
 */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Monitor, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Select } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { api } from '@/lib/api'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { Detail } from '../CampaignPreviewDetails'
import { NoContent } from '../CampaignThumbnail'
import { useMessageDetails, type DetailState } from '../messageDetails'
import { MessagePreview, type PreviewDevice } from '../MessagePreview'
import { CardLink, DetailCard } from '../parts'
import { setupHref } from '../setupFlow'
import { TestPublishBox } from '../TestPublishBox'
import { useCampaignMessage, useCampaignPreview, useSampleCustomers, type CampaignMessage } from '../useCampaignPreview'
import { hasAction } from '../vocabulary'
import { ChecksLine } from './ChecksLine'

export const SEND_TEST_CARD = 'send-a-test'

function DetailsCard({ campaign, editable, message }: { campaign: Campaign; editable: boolean; message: CampaignMessage }) {
  const { can } = useAuth()
  const { channel, content } = message
  const details = useMessageDetails({ campaign, channel, content, tags: content.tags })
  const version = useCampaignPreview(campaign.id, { enabled: Boolean(campaign.template) }).data?.version
  const email = channel === 'EMAIL'
  const receipt = channel === 'E_RECEIPT'
  const texts = channel === 'SMS' || channel === 'MMS'
  const inDesigner = !['SMS', 'MMS'].includes(campaign.channel)
  const template: DetailState = campaign.template_name
    ? { state: 'ready', value: `Based on ${campaign.template_name}`, secondary: version ? `Version ${version}` : undefined }
    : { state: 'missing', text: 'Not chosen yet' }
  const sender: DetailState = campaign.sender_profile ? details.sender() : { state: 'missing', text: 'Not chosen yet' }

  return (
    <DetailCard title="Details" actions={editable && <CardLink to={setupHref(campaign.id, { step: 'content' })}>Edit Content</CardLink>}>
      <div className="flex flex-col gap-5" aria-busy={details.loading || undefined}>
        <div className="flex flex-col gap-2">
          <Detail label="Template" {...template} />
          {campaign.template && can('template.edit') && (
            <Link to={`/templates/${campaign.template}/${inDesigner ? 'design' : 'message'}`} className="inline-flex w-fit items-center gap-1 text-helper font-semibold text-brand-800 hover:underline">
              Open in the {inDesigner ? 'Designer' : 'Message Editor'} <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
            </Link>
          )}
        </div>
        {(email || receipt) && <Detail label="Subject Line" {...details.subject(receipt)} />}
        {email && <Detail label="Preheader" {...details.preheader()} />}
        <Detail label="Sender" {...sender} />
        {texts && campaign.template && <Detail label="Length" {...details.length()} />}
        {receipt && <Detail label="Receipt Layout" {...details.receiptLayout()} />}
        <ChecksLine campaign={campaign} />
        {!hasAction(campaign, 'edit') && <p className="text-helper text-ink-500">A send uses the template version that is current when the run starts.</p>}
      </div>
    </DetailCard>
  )
}

export function ContentTab({ campaign, focusTest = 0 }: { campaign: Campaign; focusTest?: number }) {
  const { can, me } = useAuth()
  const [party, setParty] = useState('')
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const canTest = can('campaign.edit') && hasAction(campaign, 'test_publish')
  const editable = can('campaign.edit') && hasAction(campaign, 'edit') && !campaign.is_journey_generated
  const withCustomers = campaign.campaign_type !== 'E_RECEIPT'
  const message = useCampaignMessage(campaign)
  const customers = useSampleCustomers(campaign.id, withCustomers && Boolean(campaign.template))
  const people = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
    enabled: canTest,
  })

  // the header's "Send a test" lands here: bring the card into view and put focus on it
  useEffect(() => {
    if (!focusTest) return
    const card = document.getElementById(SEND_TEST_CARD)
    card?.scrollIntoView?.({ block: 'start' })
    card?.focus()
  }, [focusTest])

  const isEmail = message.channel === 'EMAIL' || message.channel === 'E_RECEIPT'
  const mmsImage = message.channel === 'MMS' && message.content.data?.kind === 'message' ? message.content.data.media?.url ?? null : undefined
  const controls = campaign.template && (
    <>
      {isEmail && (
        <SegmentedControl label="Preview Size" value={device} onChange={setDevice}
          options={[{ value: 'desktop', label: 'Desktop', icon: Monitor }, { value: 'mobile', label: 'Mobile', icon: Smartphone }]} />
      )}
      {withCustomers && (customers.data?.length ?? 0) > 0 && (
        <label className="flex items-center gap-2 text-helper font-semibold whitespace-nowrap text-ink-700">
          Preview As
          <Select controlSize="sm" value={party} onChange={(event) => setParty(event.target.value)} className="w-48">
            <option value="">Sample Values</option>
            {customers.data?.map((person) => <option key={person.party_id} value={person.party_id}>{person.name}</option>)}
          </Select>
        </label>
      )}
    </>
  )

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 self-start">
        <DetailCard title="Message" actions={controls}>
          {campaign.template ? (
            <div className="flex flex-col gap-4">
              <p className="text-helper text-ink-500">With the catalogue's sample values, or as one customer of the audience would get it.</p>
              <MessagePreview campaignId={campaign.id} controls={{ party, device, sender: campaign.sender_profile_name ?? 'Your brand', image: mmsImage }} />
            </div>
          ) : (
            <NoContent title="No template chosen yet" text="Choose the message on the Content step of the campaign setup."
              action={can('campaign.edit') && hasAction(campaign, 'edit') ? <Link to={setupHref(campaign.id, { step: 'content' })} className="text-sm font-semibold text-brand-800 hover:underline">Choose a Template</Link> : undefined} />
          )}
        </DetailCard>
      </div>
      <div className="flex min-w-0 flex-col gap-6 self-start">
        <DetailsCard campaign={campaign} editable={editable} message={message} />
        {canTest && (
          <div id={SEND_TEST_CARD} tabIndex={-1} className="rounded-lg outline-none focus:shadow-focus">
            <DetailCard title="Send a Test">
              <TestPublishBox campaign={campaign} people={people.data?.owners ?? []} defaultTo={me?.principal.email ?? ''} />
            </DetailCard>
          </div>
        )}
      </div>
    </div>
  )
}
