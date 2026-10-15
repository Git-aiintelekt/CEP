/**
 * Presets that are written and tested but NOT offered: each uses a personalization tag the backend does not have
 * yet. Offered today, the tag gating would hide them anyway (a preset is only offered when the workspace has every
 * tag it uses), so wiring one in early would do nothing but mislead.
 *
 * Nothing imports these into PRESET_DEFINITIONS, and a test (dormant.test.ts) fails if one turns up there.
 *
 * To wire one in once its tag exists in the backend's tag catalogue:
 *   1. import it in ../index.ts and add it to BONUS_PRESETS (or LAUNCH_PRESETS, if it joins the launch catalogue);
 *   2. remove it from DORMANT_PRESETS below, and move its expectations out of dormant.test.ts.
 * Nothing else changes: requiredTags comes from the content, which already uses the tag by its final name.
 */
import type { PresetDefinition } from '../types'

import { birthday } from './birthday'
import { mmsBirthday } from './mmsBirthday'
import { reviewRequest } from './reviewRequest'
import { smsBirthday } from './smsBirthday'
import { smsEventReminder } from './smsEventReminder'
import { smsReview } from './smsReview'

export const DORMANT_PRESETS: PresetDefinition[] = [birthday, smsBirthday, mmsBirthday, reviewRequest, smsReview, smsEventReminder]

/** The tag each dormant preset is waiting on, by preset key: the backend has to add these first. */
export const WAITING_ON: Record<string, string> = {
  birthday: 'birthday',
  sms_birthday: 'birthday',
  mms_birthday: 'birthday',
  review_request: 'review_url',
  sms_review: 'review_url',
  sms_event_reminder: 'event_date',
}
