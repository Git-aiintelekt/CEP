/** The email as an inbox lists it: sender, subject and preheader. The sender is not known at template level. */
import type { PersonalizationTag } from '@/lib/types'

import { EMAIL_CLIENTS, preheaderRoom, type EmailClient } from './clients'
import { NO_VALUE_MARKER } from './decoratePreview'
import { previewParts, type Fill, type PreviewProfile } from './previewProfiles'

export const SENDER_PLACEHOLDER = 'Your brand'
export const NO_SUBJECT = 'No subject line'
export const NO_PREHEADER = 'No preheader'

const MARK: Record<Exclude<Fill['kind'], 'value'>, string> = {
  sample: 'rounded-sm bg-brand-100 px-1 text-brand-800',
  default: 'rounded-sm bg-fill-subtle px-1 text-ink-800',
  blank: 'rounded-sm bg-fill-subtle px-1 text-ink-800 italic',
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
  /** the inbox stood in for; the generic one when left out */
  client?: EmailClient
  /** drawn dark, as the client's list would be */
  dark?: boolean
}

export function InboxRow({ subject, preheader, catalogue, profile, time, client = EMAIL_CLIENTS[0], dark = false }: InboxRowProps) {
  const room = preheaderRoom(client, subject)
  const cut = preheader.trim().length > room
  const shownPreheader = cut ? preheader.trim().slice(0, Math.max(0, room)).trimEnd() : preheader
  return (
    <div aria-label="Inbox Row" role="group" data-client={client.id} data-appearance={dark ? 'dark' : 'light'}
      className={`flex gap-3 border-b px-4 py-3 ${dark ? 'border-ink-800 bg-ink-900 text-white' : 'border-line bg-surface'}`}>
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center text-sm font-semibold ${client.avatar === 'square' ? 'rounded-sm' : 'rounded-pill'} ${dark ? 'bg-ink-800 text-white' : 'bg-fill-muted text-ink-800'}`}>
        {SENDER_PLACEHOLDER.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm font-semibold ${dark ? 'text-white' : 'text-ink-900'}`}>{SENDER_PLACEHOLDER}</span>
          <span className={`cep-num shrink-0 text-xs ${dark ? 'text-ink-300' : 'text-ink-800'}`}>{time}</span>
        </div>
        <p className={`truncate text-sm font-semibold ${dark ? 'text-white' : 'text-ink-900'}`}>
          {subject.trim() === '' ? NO_SUBJECT : <Filled text={subject} catalogue={catalogue} profile={profile} />}
        </p>
        <p className={`truncate text-xs ${dark ? 'text-ink-300' : 'text-ink-800'}`} data-preheader-cut={cut ? client.inboxChars : undefined}>
          {preheader.trim() === '' ? NO_PREHEADER : <Filled text={shownPreheader} catalogue={catalogue} profile={profile} />}{cut ? '…' : ''}
        </p>
      </div>
    </div>
  )
}
