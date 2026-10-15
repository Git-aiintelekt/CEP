import type { PresetDefinition } from '../types'

export const smsBirthday: PresetDefinition = {
  key: 'sms_birthday',
  name: 'SMS birthday gift',
  channel: 'SMS',
  category: 'Loyalty',
  description: 'A birthday greeting by text, with a gift of a discount.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: {{birthday}} is your day, {{first_name}}. Enjoy {{discount_pct}}% off with code {{offer_code}} at {{shop_url}} Reply STOP to opt out.' },
}
