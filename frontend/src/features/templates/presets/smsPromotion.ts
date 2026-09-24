import type { PresetDefinition } from './types'

export const smsPromotion: PresetDefinition = {
  key: 'sms_promotion',
  name: 'SMS offer',
  channel: 'SMS',
  category: 'Promotion',
  description: 'One-part promotional text with a code and opt-out wording.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: {{first_name}}, {{discount_pct}}% off everything this weekend with code {{offer_code}}. Shop {{shop_url}} Reply STOP to opt out.' },
}
