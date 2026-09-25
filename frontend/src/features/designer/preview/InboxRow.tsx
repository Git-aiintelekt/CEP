/** The email as an inbox lists it: sender, subject and preheader. The sender is not known at template level. */
import type { PersonalizationTag } from '@/lib/types'

import { NO_VALUE_MARKER } from './decoratePreview'
import { previewParts, type Fill, type PreviewProfile } from './previewProfiles'

export const SENDER_PLACEHOLDER = 'Your brand'
export const NO_SUBJECT = 'No subject line'
export const NO_PREHEADER = 'No preheader'

const MARK: Record<Exclude<Fill['kind'], 'value'>, string> = {
  sample: 'rounded-sm bg-brand-100 px-1 text-brand-800',
  default: 'rounded-sm bg-line-subtle px-1 text-ink-700',
  blank: 'rounded-sm bg-line-subtle px-1 text-ink-500 italic',
  unknown: 'rounded-sm bg-danger-bg px-1 text-danger-text',
}

function Filled({ text, catalogue, profile }: { text: string; catalogue: PersonalizationTag[]; profile: PreviewProfile }) {
  return previewParts(text, catalogue, profile).map((part, index) =>
    typeof part === 'string' || part.kind === 'value' ?
      <span key={index}>{typeof part === 'string' ? part : part.text}</span>
    : <span key={index} data-fill={part.kind} className={MARK[part.kind]}>
        {part.kind === 'blank' ? NO_VALUE_MARKER : part.text}
      </span>,
  )
}

interface InboxRowProps {
  subject: string
  preheader: string
  catalogue: PersonalizationTag[]
  profile: PreviewProfile
  time: string
}

export function InboxRow({ subject, preheader, catalogue, profile, time }: InboxRowProps) {
  return (
    <div aria-label="Inbox Row" role="group" className="flex gap-3 border-b border-line bg-surface px-4 py-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-line text-sm font-semibold text-ink-700">
        {SENDER_PLACEHOLDER.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink-900">{SENDER_PLACEHOLDER}</span>
          <span className="cep-num shrink-0 text-xs text-ink-500">{time}</span>
        </div>
        <p className="truncate text-sm font-semibold text-ink-900">
          {subject.trim() === '' ? NO_SUBJECT : <Filled text={subject} catalogue={catalogue} profile={profile} />}
        </p>
        <p className="truncate text-xs text-ink-500">
          {preheader.trim() === '' ? NO_PREHEADER : <Filled text={preheader} catalogue={catalogue} profile={profile} />}
        </p>
      </div>
    </div>
  )
}
