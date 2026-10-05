/**
 * Create Template, in the shared set-up frame: 1 the name, channel and description; 2 where it starts, Blank (picked
 * for you) or one of CEP's starters (the same picker as /templates/new). Creating opens the template in its editor.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Field, TextArea, TextInput } from '@/components/Form'
import { SetupDialog } from '@/components/SetupDialog'
import { ChoiceCard, ChoiceGroup } from '@/features/campaigns/parts'
import { api, ApiError } from '@/lib/api'
import { editorRouteFor } from '@/lib/editorRoute'
import { channelAllowed } from '@/lib/features'
import { useFieldRules } from '@/lib/fieldRules'
import type { Template } from '@/lib/types'

import { lookOf } from './channels'
import { StarterGallery } from './StarterGallery'

const CHANNELS = [
  { value: 'EMAIL', label: 'Email', hint: 'Opens the drag-and-drop email designer.' },
  { value: 'E_RECEIPT', label: 'E-Receipt', hint: 'Transactional receipt email. Opens the receipt editor.' },
  { value: 'SMS', label: 'SMS', hint: 'Text message. Opens the message editor with live part counting.' },
  { value: 'MMS', label: 'MMS', hint: 'Picture message: text plus one image. Opens the message editor.' },
]

/** the fields step 1 owns: an API error on one of them sends the person back there */
const STEP_ONE_FIELDS = ['name', 'channel', 'description']

/** `channel`: picked already (the Templates page's channel cards); Home leaves it to the person */
export function CreateTemplateModal({ channel: initialChannel, onClose }: { channel?: string; onClose: () => void }) {
  const { has } = useAuth()
  const channels = CHANNELS.filter((item) => channelAllowed(has, item.value))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formId = useId()
  const rule = useFieldRules('template')
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState(() => initialChannel ?? channels[0]?.value ?? 'EMAIL')
  const [description, setDescription] = useState('')
  const [starter, setStarter] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const create = useMutation({
    mutationFn: () => api.post<Template>('/templates/', { name: name.trim(), channel, description: description.trim() || null, ...(starter ? { starter } : {}) }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/templates/${template.id}/${editorRouteFor(template.channel)}`)
    },
    onError: (error) => {
      const fields = error instanceof ApiError && error.status === 400 ? error.fieldErrors : {}
      if (Object.keys(fields).some((key) => STEP_ONE_FIELDS.includes(key))) setStep(1)
      setErrors(Object.keys(fields).length ? fields : { form: error.message })
    },
  })

  function next(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 3) {
      setErrors({ name: 'Use at least 3 characters.' })
      return
    }
    setErrors({})
    setStep(2)
  }

  return (
    <SetupDialog
      title="Create Template"
      steps={['Name, Channel and Description', 'Start From']}
      step={step}
      onClose={onClose}
      locked={create.isPending}
      wide={step === 2}
      onBack={step === 2 ? () => setStep(1) : undefined}
      primary={step === 1
        ? { label: 'Next', disabled: name.trim() === '', form: formId }
        : { label: 'Create Template', busy: create.isPending, busyLabel: 'Creating', onClick: () => create.mutate() }}
      error={errors.form ? { title: 'Template Wasn’t Created', message: errors.form, onRetry: () => create.mutate() } : null}
    >
      {step === 1 ? (
        <form id={formId} onSubmit={next} noValidate className="flex flex-col gap-6">
          <Field label="Template Name" required strong error={errors.name} limit={{ used: name.length, max: rule('name')?.max ?? 200 }}>
            {(ids) => <TextInput {...ids} value={name} maxLength={rule('name')?.max ?? 200} data-autofocus placeholder="e.g. Fall Sale Announcement" onChange={(event) => { setName(event.target.value); setErrors({}) }} />}
          </Field>
          <ChoiceGroup label="Channel" required strong error={errors.channel} hint="Decides which editor opens and which campaigns can use the template. Fixed once created." columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
            {channels.map((item) => {
              const Icon = lookOf(item.value).icon
              return <ChoiceCard key={item.value} tile selected={channel === item.value} onSelect={() => { setChannel(item.value); setStarter('') }} title={item.label} text={item.hint} icon={<Icon size={20} strokeWidth={1.5} />} />
            })}
          </ChoiceGroup>
          <Field label="Description (Optional)" strong error={errors.description} hint="What this template is for. Shown in the template list.">
            {(ids) => <TextArea {...ids} rows={3} value={description} placeholder="e.g. Seasonal promo with a hero and three product blocks" onChange={(event) => setDescription(event.target.value)} />}
          </Field>
        </form>
      ) : (
        <>
          <StarterGallery bare channel={channel} value={starter} onChange={(key, chosen) => {
            setStarter(key)
            if (chosen && !description.trim()) setDescription(chosen.description)
          }} />
          {errors.starter && <p role="alert" className="text-sm font-medium text-danger-text">{errors.starter}</p>}
        </>
      )}
    </SetupDialog>
  )
}
