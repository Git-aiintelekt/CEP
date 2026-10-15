import type { PresetDefinition } from './types'

export const smsCoupon: PresetDefinition = {
  key: 'sms_coupon',
  name: 'SMS coupon',
  channel: 'SMS',
  category: 'Coupon',
  description: 'A personal discount code by text, framed as a gift rather than a sale.',
  content: { kind: 'message', subject_line: '', sms_body: "Your Brand: {{first_name}}, here's {{discount_pct}}% off, just for you. Your code is {{offer_code}}. Shop {{shop_url}} Reply STOP to opt out." },
}
