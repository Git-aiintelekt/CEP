import type { PresetDefinition } from './types'

/** The text sibling of the Win-back offer email: the same warm "come back", with the code. */
export const smsWinback: PresetDefinition = {
  key: 'sms_winback',
  name: 'We miss you',
  channel: 'SMS',
  category: 'Retention',
  description: 'Invites a lapsed customer back with a discount code.',
  content: { kind: 'message', subject_line: '', sms_body: "Your Brand: We miss you, {{first_name}}. Come back for {{discount_pct}}% off your next order with code {{offer_code}} at {{shop_url}} Reply STOP to opt out." },
}
