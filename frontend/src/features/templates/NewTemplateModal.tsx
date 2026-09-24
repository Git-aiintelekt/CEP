/** Step 1 of 2 from a quick-create card: name the template, then open its editor. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { buttonPrimary, buttonSecondary, Field, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { api, ApiError } from '@/lib/api'
import { editorPathFor } from '@/lib/editorRoute'
import type { Template } from '@/lib/types'

import { CHANNEL_LOOK, type TemplateChannel } from './channels'

/** Shown and toggled, never sent: templates have no tags field yet. */
const TAG_CHOICES = ['Promotional', 'Transactional', 'Lifecycle', 'Loyalty', 'Seasonal', 'Test']
const FORM_ID = 'new-template-form'

export function NewTemplateModal({ channel, onClose }: { channel: TemplateChannel; onClose: () => void }) {
  const look = CHANNEL_LOOK[channel]
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const create = useMutation({
    mutationFn: () => api.post<Template>('/templates/', { name: name.trim(), channel, description: description.trim() || null }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ['templates'] })
      navigate(editorPathFor(template))
    },
    onError: (error) => {
      const fields = error instanceof ApiError && error.status === 400 ? error.fieldErrors : {}
      const shown = fields.name || fields.description
      setErrors(shown ? fields : { form: Object.values(fields)[0] ?? error.message })
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 3) {
      setErrors({ name: 'Use at least 3 characters.' })
      return
    }
    create.mutate()
  }

  const toggle = (tag: string) => setPicked((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))
  const Icon = look.icon

  return (
    <Modal
      title={`New ${look.label} template`}
      subtitle="Step 1 of 2 · name it before you design"
      onClose={onClose}
      leading={
        <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${look.tint} ${look.iconColor}`}>
          <Icon size={20} strokeWidth={1.5} />
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button type="submit" form={FORM_ID} disabled={name.trim() === '' || create.isPending} className={buttonPrimary}>
            {create.isPending && <Spinner size="sm" tone="onBrand" />}
            Continue to editor
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Template name" required error={errors.name} hint="Shown in the template list and when picking a template in a campaign">
          {(ids) => (
            <TextInput {...ids} value={name} maxLength={200} placeholder="Fall Sale Announcement" onChange={(event) => { setName(event.target.value); setErrors({}) }} />
          )}
        </Field>
        <Field label="Description (optional)" error={errors.description}>
          {(ids) => <TextArea {...ids} rows={3} value={description} placeholder="What this template is for, and when to use it" onChange={(event) => setDescription(event.target.value)} />}
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-ink-700">Tags (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAG_CHOICES.map((tag) => {
              const on = picked.includes(tag)
              const Mark = on ? Check : Plus
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag)}
                  className={`inline-flex h-7 items-center gap-1 rounded-sm border px-2.5 text-xs font-semibold transition-colors duration-fast ease-standard ${on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle active:bg-line-subtle'}`}
                >
                  <Mark size={12} strokeWidth={2} aria-hidden />
                  {tag}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-helper text-ink-500">
          <span className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">Channel</span>
          <Tag>{look.label}</Tag>
          <span>can't be changed later</span>
        </div>
        {errors.form && <p role="alert" className="text-sm font-medium text-danger-text">{errors.form}</p>}
      </form>
    </Modal>
  )
}
