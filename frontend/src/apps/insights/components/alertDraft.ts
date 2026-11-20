/** An alert being made or changed, pure: its draft from a saved one, whether it is ready, and the body the API takes. */
import type { AlertBody, AlertOp, ReportAlert } from '../types'

export interface AlertDraft { measure: string; op: AlertOp; threshold: string; every: 'hour' | 'day'; at: string; recipients: string; name: string }

export const ALERT_OPS: { value: AlertOp; label: string }[] = [{ value: '<', label: 'Falls below' }, { value: '<=', label: 'Is at or below' }, { value: '>', label: 'Rises above' }, { value: '>=', label: 'Is at or above' }]

export function alertDraftOf(alert: ReportAlert | null, firstMeasure: string, email: string): AlertDraft {
  return alert
    ? { measure: alert.measure, op: alert.op, threshold: String(alert.threshold), every: alert.every, at: alert.at_time ?? '08:00', recipients: alert.recipients.join(', '), name: alert.name ?? '' }
    : { measure: firstMeasure, op: '<', threshold: '', every: 'day', at: '08:00', recipients: email, name: '' }
}

export const alertReady = (draft: AlertDraft) => Boolean(draft.measure && draft.threshold.trim() !== '' && Number.isFinite(Number(draft.threshold)) && draft.recipients.trim())

export function alertBody(draft: AlertDraft, reportId: string): AlertBody {
  return { report_id: reportId, measure: draft.measure, op: draft.op, threshold: Number(draft.threshold), every: draft.every, ...(draft.every === 'day' ? { at_time: draft.at } : {}),
    recipients: draft.recipients.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean), ...(draft.name.trim() ? { name: draft.name.trim() } : {}) }
}
