import type { PresetDefinition } from './types'

/**
 * An invitation with no date field: the catalogue has no event_date tag yet, so it says "this weekend".
 * Ships without a picture: the MMS editor asks for one before the template can be activated.
 */
export const mmsEventInvite: PresetDefinition = {
  key: 'mms_event_invite',
  name: 'Store opening/event invite',
  channel: 'MMS',
  category: 'Promotion',
  description: 'Invites people to a store opening or in-store event. Add your picture before activating.',
  content: { kind: 'message', subject_line: "You're invited", sms_body: "Your Brand: {{first_name}}, you're invited to our store opening this weekend. Early access and a few surprises. See {{shop_url}} Reply STOP to opt out." },
}
