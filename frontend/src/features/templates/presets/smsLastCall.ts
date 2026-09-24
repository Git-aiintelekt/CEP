import type { PresetDefinition } from './types'

export const smsLastCall: PresetDefinition = {
  key: 'sms_last_call',
  name: 'Last call',
  channel: 'SMS',
  category: 'Promotion',
  description: 'The final-hours reminder: the offer ends tonight.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: Last call, {{first_name}}. {{discount_pct}}% off ends at midnight tonight. Use code {{offer_code}} at {{shop_url}} Reply STOP to opt out.' },
}
