import type { PresetDefinition } from './types'

export const smsPoints: PresetDefinition = {
  key: 'sms_points',
  name: 'SMS points reminder',
  channel: 'SMS',
  category: 'Loyalty',
  description: 'Reminds a member of their points balance.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: {{first_name}}, you have {{loyalty_points}} points to spend as a {{loyalty_tier}} member. Use them at {{shop_url}} Reply STOP to opt out.' },
}
