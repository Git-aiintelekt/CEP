/**
 * The Content step's subject line and preheader fields (inside the Subject and Preheader row): the template's unless this campaign has its own. Only the campaign
 * changes; the template stays as it is. Blank = the template's. Saved with the step, as `subject_line` / `preheader`.
 * An emoji goes in at the caret; picked while the field is empty, it is added to the template's text, which becomes this
 * campaign's own, so the template's emoji can be changed without retyping the line.
 */
import { useRef } from 'react'
import { useFormContext } from 'react-hook-form'

import { EmojiPickerButton } from '@/apps/cep/features/emoji/EmojiPickerButton'
import { charCount } from '@/apps/cep/features/emoji/text'
import { Counter, Field, TextInput } from '@/components/Form'
import { usePreviewContent } from '@/apps/cep/features/templates/preview/usePreviewContent'
import { useFieldRules } from '@/lib/fieldRules'
import type { Template } from '@/lib/types'

import type { CampaignFormValues } from '../schema'

const HEADER_MAX = 300
/** what an inbox shows before it cuts off; the table allows 300 */
const INBOX_SHOWS: Record<Key, number> = { subject_line: 60, preheader: 90 }
const LINK = 'text-sm font-medium text-brand-800 hover:underline'

type Key = 'subject_line' | 'preheader'

export function SubjectPreheaderCard({ template }: { template: Template }) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const content = usePreviewContent({ kind: 'template', template })
  const email = content.data?.kind === 'email' ? content.data : null
  const theirs: Record<Key, string> = { subject_line: email?.subject.trim() ?? '', preheader: email?.preheader.trim() ?? '' }
  const own: Record<Key, string> = { subject_line: watch('subject_line'), preheader: watch('preheader') }
  const set = (key: Key, value: string) => setValue(key, value, { shouldDirty: true, shouldValidate: true })
  const rule = useFieldRules('campaign')
  const inputs = useRef<Partial<Record<Key, HTMLInputElement | null>>>({})

  const addEmoji = (key: Key, emoji: string) => {
    const element = inputs.current[key]
    const mine = own[key].trim() !== ''
    const text = mine ? own[key] : theirs[key]
    const start = mine ? element?.selectionStart ?? text.length : text.length
    const end = mine ? element?.selectionEnd ?? text.length : text.length
    set(key, text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const field = (key: Key, label: string) => {
    const mine = own[key].trim() !== ''
    const counter = <Counter used={charCount(own[key])} max={rule(key)?.max ?? HEADER_MAX} soft={INBOX_SHOWS[key]} />
    return (
      <Field label={label} strong error={errors[key]?.message}
        labelEnd={(
          <span className="flex items-center gap-3">
            {!mine && theirs[key] && <button type="button" className={LINK} onClick={() => set(key, theirs[key])}>Edit the Template's</button>}
            {counter}
            <EmojiPickerButton onPick={(emoji) => addEmoji(key, emoji)} />
          </span>
        )}>
        {(ids) => {
          const { ref, ...input } = register(key)
          return (
            <TextInput {...ids} {...input} ref={(element) => { ref(element); inputs.current[key] = element }} maxLength={rule(key)?.max ?? HEADER_MAX}
              placeholder={theirs[key] || undefined} />
          )
        }}
      </Field>
    )
  }

  return (
    <div className="space-y-4">
      {field('subject_line', 'Subject Line')}
      {field('preheader', 'Preheader')}
    </div>
  )
}
