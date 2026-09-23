import type { PresetDefinition } from '../types'

export const smsReview: PresetDefinition = {
  key: 'sms_review',
  name: 'Rate your purchase',
  channel: 'SMS',
  category: 'Post-purchase',
  description: 'Asks for a quick rating of a recent purchase.',
  content: { kind: 'message', subject_line: '', sms_body: 'Your Brand: Thanks for your purchase, {{first_name}}. How did we do? Rate it in a minute: {{review_url}} Reply STOP to opt out.' },
}
