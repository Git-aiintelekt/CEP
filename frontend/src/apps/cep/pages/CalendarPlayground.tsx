/**
 * /dev/calendar (dev builds only): the Campaigns calendar on sample spans, for design review without the API. Calendar
 * requests on this page are answered here; nothing else is touched. ?mode=week&start=&journeys=0&channel= work as on /campaigns.
 */
import { useSearchParams } from 'react-router-dom'

import { CampaignCalendar } from '@/apps/cep/features/campaigns/CampaignCalendar'
import { addDays, todayIn } from '@/apps/cep/features/reports/period'
import type { CalendarSpan, CampaignCalendarData } from '@/lib/types'
import { atZone } from '@/lib/zonedTime'

const ZONE = 'America/New_York'

type Send = CalendarSpan['sends'][number]
function span(campaign: string, name: string, channel: string, display_status: string, sends: Send[], extra: Partial<CalendarSpan> = {}): CalendarSpan {
  return {
    campaign, name, code: null, channel, campaign_type: 'REGULAR_MARKETING', display_status, is_journey_generated: false, setup_step: 6, setup_complete: true, actions: [],
    timezone: ZONE, start: sends[0].at, end: sends.at(-1)!.at, ongoing: false, failed: false, sends, ...extra,
  }
}

function sampleSpans(): CalendarSpan[] {
  const today = todayIn(ZONE)
  const at = (offset: number, time: string, state: Send['state'] = 'WAITING', label: string | null = null): Send => ({ at: atZone(addDays(today, offset), time, ZONE), state, label })
  return [
    span('c01', 'October Newsletter Preview', 'EMAIL', 'SCHEDULED', [at(0, '08:00', 'SENT'), at(1, '09:00')]),
    span('j1', 'Welcome Series', 'EMAIL', 'ACTIVE', [at(0, '09:30', 'SENT', 'Step 2'), at(2, '09:30', 'WAITING', 'Step 3')], { is_journey_generated: true }),
    span('c04', 'Flash Sale Reminder', 'SMS', 'SCHEDULED', [at(0, '11:30'), at(3, '10:00')]),
    span('c06', 'Fall Boots Launch', 'EMAIL', 'PRODUCTION_PUBLISHED', [at(0, '14:00')]),
    span('c14', 'Weekend Lookbook Preview', 'MMS', 'SCHEDULED', [at(0, '18:00')]),
    span('j2', 'Cart Recovery', 'SMS', 'ACTIVE', [at(0, '20:00', 'WAITING', 'Nudge'), at(3, '16:00', 'WAITING', 'Nudge')], { is_journey_generated: true }),
    span('c09', 'Back in Stock Alert', 'EMAIL', 'PAUSED', [at(1, '15:00')]),
    span('c11', 'Fall Denim Drop', 'EMAIL', 'PRODUCTION_PUBLISHED', [at(3, '08:00', 'SENT')], { failed: true }),
    span('c08', 'Loyalty Points Statement', 'EMAIL', 'SCHEDULED', [at(3, '14:00')]),
    span('c13', 'Price Drop Alerts', 'SMS', 'SCHEDULED', [at(4, '10:00')]),
    span('c15', 'Weekly Deals Digest', 'EMAIL', 'SCHEDULED', [at(6, '09:00'), at(13, '09:00')], { campaign_type: 'REGULAR_MARKETING' }),
    span('c12', 'Birthday Rewards', 'SMS', 'ACTIVE', [at(6, '13:00')]),
    span('c20', 'VIP Early Access: Autumn Collection for Platinum and Gold Members', 'EMAIL', 'SCHEDULED', [at(1, '11:00'), at(-6, '11:00', 'SENT')]),
  ]
}

let installed = false
/** answers /campaigns/calendar/ on this page only, filtered like the API (channel, and the date window) */
function installSampleCalendar() {
  if (installed) return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.origin)
    if (!url.pathname.endsWith('/campaigns/calendar/') || !window.location.pathname.startsWith('/dev/calendar')) return original(input, init)
    const from = url.searchParams.get('date_from') ?? ''
    const to = url.searchParams.get('date_to') ?? ''
    const channel = url.searchParams.get('channel')
    const spans = sampleSpans()
      .filter((item) => !channel || item.channel === channel)
      .map((item) => ({ ...item, sends: item.sends.filter((send) => { const day = todayIn(ZONE, new Date(send.at)); return day >= from && day <= to }) }))
      .filter((item) => item.sends.length > 0)
    const body: CampaignCalendarData = { date_from: from, date_to: to, timezone: ZONE, spans }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

export default function CalendarPlayground() {
  installSampleCalendar()
  const [params] = useSearchParams()
  const channel = params.get('channel')
  return <CampaignCalendar filters={channel ? { channel } : {}} zone={ZONE} canEdit />
}
