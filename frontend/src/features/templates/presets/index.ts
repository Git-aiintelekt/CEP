/** Presets whose content the frontend owns, in the order the Templates page lists them. */
import { finalMarkdowns } from './finalMarkdowns'
import { coupon } from './coupon'
import { flashSale } from './flashSale'
import { loyalty } from './loyalty'
import { mmsEventInvite } from './mmsEventInvite'
import { mmsFlashSale } from './mmsFlashSale'
import { mmsHoliday } from './mmsHoliday'
import { mmsLookbook } from './mmsLookbook'
import { newArrivals } from './newArrivals'
import { newsletter } from './newsletter'
import { promotion } from './promotion'
import { RECEIPT_PRESETS } from './receiptPresets'
import { seasonal } from './seasonal'
import { smsCoupon } from './smsCoupon'
import { smsLastCall } from './smsLastCall'
import { smsOptIn } from './smsOptIn'
import { smsPoints } from './smsPoints'
import { smsPromotion } from './smsPromotion'
import { smsWinback } from './smsWinback'
import type { PresetDefinition } from './types'
import { welcome } from './welcome'
import { winback } from './winback'

export type { PresetDefinition } from './types'

/** The 13-preset launch catalogue, by channel. */
export const LAUNCH_PRESETS: PresetDefinition[] = [
  welcome, promotion, flashSale, finalMarkdowns, newArrivals, seasonal, newsletter,
  smsOptIn, smsPromotion, smsLastCall,
  mmsFlashSale, mmsHoliday, mmsEventInvite,
]

/** Offered after the launch catalogue: built before it was set, or added since. */
export const BONUS_PRESETS: PresetDefinition[] = [loyalty, winback, smsPoints, mmsLookbook, smsWinback, coupon, smsCoupon]

export { RECEIPT_PRESETS }

/** E-receipt presets are listed only where e-receipts are on: the page asks for the channels the workspace can use. */
export const PRESET_DEFINITIONS: PresetDefinition[] = [...LAUNCH_PRESETS, ...BONUS_PRESETS, ...RECEIPT_PRESETS]
