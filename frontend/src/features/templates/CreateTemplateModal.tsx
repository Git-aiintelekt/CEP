/**
 * Create Template as a pop-up, in two steps: 1 the name, channel and description; 2 where it starts, blank or from one of
 * CEP's starters (the same picker as /templates/new). Creating opens the template in its editor.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { api, ApiError } from '@/lib/api'
import { editorRouteFor } from '@/lib/editorRoute'
import { channelAllowed } from '@/lib/features'
import { useFieldRules } from '@/lib/fieldRules'
import type { Template } from '@/lib/types'

import { StarterGallery } from './StarterGallery'

const CHANNELS = [
  { value: 'EMAIL', label: 'Email', hint: 'Opens the drag-and-drop email designer.' },
  { value: 'E_RECEIPT', label: 'E-Receipt', hint: 'Transactional receipt email. Opens the receipt editor.' },
  { value: 'SMS', label: 'SMS', hint: 'Text message. Opens the message editor with live part counting.' },
  { value: 'MMS', label: 'MMS', hint: 'Picture message: text plus one image. Opens the message editor.' },
]

/** What the create button promises, by the editor the new template opens in. */
const CREATE_LABEL: Record<ReturnType<typeof editorRouteFor>, string> = {
  design: 'Create and Open the Designer',
  receipt: 'Create and Open the Receipt Editor',
  message: 'Create and Write the Message',
}

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

  const look = CHANNELS.find((item) => item.value === channel)
  return (
    <Modal
      title="Create a Template"
      subtitle={step === 1 ? 'Step 1 of 2 · Name, channel and description' : `Step 2 of 2 · Start blank or from a starter · ${look?.label ?? ''}`}
      onClose={onClose}
      size={step === 1 ? 'md' : 'screen'}
      scrollBody
      footer={step === 1 ? (
        <>
          <button type="button" onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button type="submit" form={formId} disabled={name.trim() === ''} className={buttonPrimary}>Next</button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setStep(1)} className={`${buttonSecondary} mr-auto`}><ArrowLeft size={16} strokeWidth={1.5} aria-hidden />Back</button>
          <button type="button" onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className={buttonPrimary}>
            {create.isPending && <Spinner size="sm" tone="onBrand" />}
            {CREATE_LABEL[editorRouteFor(channel)]}
          </button>
        </>
      )}
    >
      {step === 1 ? (
        <form id={formId} onSubmit={next} noValidate className="space-y-4">
          <Field label="Template Name" required error={errors.name} limit={{ used: name.length, max: rule('name')?.max ?? 200 }}>
            {(ids) => <TextInput {...ids} value={name} maxLength={rule('name')?.max ?? 200} autoFocus placeholder="Fall Sale Announcement" onChange={(event) => { setName(event.target.value); setErrors({}) }} />}
          </Field>
          <Field label="Channel" required error={errors.channel} help="Decides which editor opens and which campaigns can use the template. Fixed once created." hint={look?.hint}>
            {(ids) => (
              <Select {...ids} value={channel} onChange={(event) => { setChannel(event.target.value); setStarter('') }}>
                {channels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Description (Optional)" error={errors.description} hint="What this template is for. Shown in the template list.">
            {(ids) => <TextArea {...ids} rows={3} value={description} placeholder="What this template is for, and when to use it" onChange={(event) => setDescription(event.target.value)} />}
          </Field>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <StarterGallery channel={channel} value={starter} onChange={(key, chosen) => {
            setStarter(key)
            if (chosen && !description.trim()) setDescription(chosen.description)
          }} />
          {(errors.starter || errors.form) && <p role="alert" className="text-sm font-medium text-danger-text">{errors.starter ?? errors.form}</p>}
        </div>
      )}
    </Modal>
  )
}
