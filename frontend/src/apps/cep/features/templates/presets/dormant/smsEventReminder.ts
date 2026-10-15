import type { PresetDefinition } from '../types'

/** SMS rather than MMS: a reminder needs no picture, and it should not wait on one before it can be activated. */
export const smsEventReminder: PresetDefinition = {
  key: 'sms_event_reminder',
  name: 'In-store event reminder',
  channel: 'SMS',
  category: 'Promotion',
  description: 'Reminds people of an in-store event, with its date.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: A reminder, {{first_name}}: our in-store event is on {{event_date}}. Come early for first pick. See {{shop_url}} Reply STOP to opt out.' },
}
