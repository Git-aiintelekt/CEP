/**
 * The Content step's subject line and preheader: the template's unless this campaign has its own. Only the campaign
 * changes; the template stays as it is. Blank = the template's. Saved with the step, as `subject_line` / `preheader`.
 */
import { useFormContext } from 'react-hook-form'

import { Field, TextInput } from '@/components/Form'
import { InboxRow } from '@/features/designer/preview/InboxRow'
import { DEFAULT_PROFILE } from '@/features/designer/preview/previewProfiles'
import { usePreviewContent } from '@/features/templates/preview/usePreviewContent'
import type { Template } from '@/lib/types'

import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'

const HEADER_MAX = 300
const LINK = 'text-sm font-medium text-brand-800 hover:underline'

type Key = 'subject_line' | 'preheader'

export function SubjectPreheaderCard({ template }: { template: Template }) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<CampaignFormValues>()
  const content = usePreviewContent({ kind: 'template', template })
  const email = content.data?.kind === 'email' ? content.data : null
  const theirs: Record<Key, string> = { subject_line: email?.subject.trim() ?? '', preheader: email?.preheader.trim() ?? '' }
  const own: Record<Key, string> = { subject_line: watch('subject_line'), preheader: watch('preheader') }
  const set = (key: Key, value: string) => setValue(key, value, { shouldDirty: true, shouldValidate: true })

  const field = (key: Key, label: string, nothing: string) => {
    const mine = own[key].trim() !== ''
    const hint = mine
      ? theirs[key] ? `This campaign's own. The template's: “${theirs[key]}”` : "This campaign's own. The template has none."
      : content.isPending ? 'Loading the template' : theirs[key] ? "Empty: the template's is used." : nothing
    return (
      <Field label={label} error={errors[key]?.message} hint={hint}
        labelEnd={mine ? <button type="button" className={LINK} onClick={() => set(key, '')}>Use the Template's</button>
          : theirs[key] ? <button type="button" className={LINK} onClick={() => set(key, theirs[key])}>Edit the Template's</button> : null}>
        {(ids) => <TextInput {...ids} {...register(key)} maxLength={HEADER_MAX} placeholder={theirs[key] || undefined} />}
      </Field>
    )
  }

  return (
    <Panel title="Subject Line and Preheader" description="The template's are used unless you write this campaign's own. The template itself does not change.">
      <div className="space-y-4">
        {field('subject_line', 'Subject Line', 'The template has no subject line: write one here or in the template.')}
        {field('preheader', 'Preheader', 'The template has no preheader. Optional: the text an inbox shows after the subject.')}
        <p className="text-xs text-ink-800">Tags such as {'{{first_name}}'} work in both.</p>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-800">In the Inbox</p>
          <div className="overflow-hidden rounded-sm border border-line [&>div]:border-b-0">
            <InboxRow subject={own.subject_line.trim() || theirs.subject_line} preheader={own.preheader.trim() || theirs.preheader}
              catalogue={content.tags} profile={DEFAULT_PROFILE} time="9:41" />
          </div>
        </div>
      </div>
    </Panel>
  )
}
