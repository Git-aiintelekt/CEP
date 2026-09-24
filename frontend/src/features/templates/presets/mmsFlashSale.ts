import type { PresetDefinition } from './types'

/** Ships without a picture: the MMS editor asks for one before the template can be activated. */
export const mmsFlashSale: PresetDefinition = {
  key: 'mms_flash_sale',
  name: 'Flash sale graphic',
  channel: 'MMS',
  category: 'Promotion',
  description: 'A one-day sale announced with a sale graphic. Add your picture before activating.',
  content: { kind: 'message', subject_line: 'Flash sale', sms_body: 'Your Brand: Flash sale, {{first_name}}. {{discount_pct}}% off everything, today only, with code {{offer_code}}. Shop {{shop_url}} Reply STOP to opt out.' },
}
