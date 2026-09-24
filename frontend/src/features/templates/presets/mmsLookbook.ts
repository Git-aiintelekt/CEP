import type { PresetDefinition } from './types'

/** Ships without a picture: the MMS editor asks for one before the template can be activated. */
export const mmsLookbook: PresetDefinition = {
  key: 'mms_lookbook',
  name: 'MMS lookbook',
  channel: 'MMS',
  category: 'Promotion',
  description: 'Picture message announcing a new collection. Add your picture before activating.',
  content: { kind: 'message', subject_line: 'New season', sms_body: 'Your Brand: {{first_name}}, the new season lookbook just landed. See every look at {{shop_url}} Reply STOP to opt out.' },
}
