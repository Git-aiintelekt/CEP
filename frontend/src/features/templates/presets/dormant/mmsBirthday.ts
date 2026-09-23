import type { PresetDefinition } from '../types'

/** Ships without a picture: the MMS editor asks for one before the template can be activated. */
export const mmsBirthday: PresetDefinition = {
  key: 'mms_birthday',
  name: 'MMS birthday card',
  channel: 'MMS',
  category: 'Loyalty',
  description: 'A birthday card with a gift of a discount. Add your picture before activating.',
  content: { kind: 'message', subject_line: 'Happy birthday', sms_body: 'Your Brand: Happy birthday, {{first_name}}. {{birthday}} is your day, so take {{discount_pct}}% off with code {{offer_code}} at {{shop_url}} Reply STOP to opt out.' },
}
