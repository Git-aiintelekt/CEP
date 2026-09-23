import type { PresetDefinition } from './types'

/** Ships without a picture: the MMS editor asks for one before the template can be activated. */
export const mmsHoliday: PresetDefinition = {
  key: 'mms_holiday',
  name: 'Holiday campaign',
  channel: 'MMS',
  category: 'Promotion',
  description: 'A holiday offer paired with a seasonal picture. Add your picture before activating.',
  content: { kind: 'message', subject_line: 'Holiday gifting', sms_body: 'Your Brand: {{first_name}}, our holiday gift shop is open. Take {{discount_pct}}% off with code {{offer_code}} at {{shop_url}} Reply STOP to opt out.' },
}
