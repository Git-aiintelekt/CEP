import type { PresetDefinition } from './types'

/** The one text that is not a promotion: it confirms the sign-up. It is also the first text they get, so it says how to stop. */
export const smsOptIn: PresetDefinition = {
  key: 'sms_opt_in',
  name: 'Opt-in confirmation + welcome',
  channel: 'SMS',
  category: 'Onboarding',
  description: 'Confirms a text sign-up and welcomes the subscriber, in one message.',
  content: { kind: 'message', subject_line: '', sms_body: "Your Brand: Thanks, {{first_name}}, you're subscribed to texts. Expect news and offers a few times a month. Msg & data rates may apply. Reply STOP to opt out." },
}
