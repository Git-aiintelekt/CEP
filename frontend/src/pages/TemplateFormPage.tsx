/** /templates/new : name + channel, then straight into the designer for email channels. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary, Field, FormSection, Select, TextArea, TextInput } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { StarterGallery } from '@/features/templates/StarterGallery'
import { api, ApiError } from '@/lib/api'
import { channelAllowed } from '@/lib/features'
import type { Template } from '@/lib/types'

const CHANNELS = [
  { value: 'EMAIL', label: 'Email', hint: 'Opens the drag-and-drop email designer.' },
  { value: 'E_RECEIPT', label: 'E-receipt', hint: 'Transactional receipt email. Opens the email designer.' },
  { value: 'SMS', label: 'SMS', hint: 'Text message. Opens the message editor with live part counting.' },
  { value: 'MMS', label: 'MMS', hint: 'Picture message: text plus one image. Opens the message editor.' },
]

export function TemplateFormPage() {
  const { can, has } = useAuth()
  const channels = CHANNELS.filter((item) => channelAllowed(has, item.value))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState(() => channels[0]?.value ?? 'EMAIL')
  const [description, setDescription] = useState('')
  const [starter, setStarter] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const create = useMutation({
    mutationFn: () => api.post<Template>('/templates/', { name: name.trim(), channel, description: description.trim() || null, ...(starter ? { starter } : {}) }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/templates/${template.id}/${['EMAIL', 'E_RECEIPT'].includes(template.channel) ? 'design' : 'message'}`, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        setErrors(error.fieldErrors)
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      }
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 3) {
      setErrors({ name: 'Use at least 3 characters.' })
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    create.mutate()
  }

  if (!can('template.edit')) {
    return <ErrorState title="You cannot create templates" error={new Error('Ask a Marketing Admin for the template.edit permission.')} />
  }
  const otherError = create.isError && !(create.error instanceof ApiError && create.error.status === 400) ? create.error : null

  return (
    <section className="max-w-5xl">
      <Link to="/templates" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Templates</Link>
      <PageHeader title="New template" description="Created as a draft. Activate it from the designer when it is ready to be used by campaigns." />
      {otherError !== null && (
        <div className="mb-4">
          <ErrorState title="Could not create the template" error={otherError} />
        </div>
      )}
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
        <FormSection title="Template">
          <Field label="Name" required error={errors.name}>
            {(ids) => <TextInput {...ids} value={name} maxLength={200} autoFocus onChange={(event) => { setName(event.target.value); setErrors({}) }} />}
          </Field>
          <Field label="Channel" required error={errors.channel} hint={CHANNELS.find((item) => item.value === channel)?.hint}>
            {(ids) => (
              <Select {...ids} value={channel} onChange={(event) => { setChannel(event.target.value); setStarter('') }}>
                {channels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            )}
          </Field>
          <div className="lg:col-span-2">
            <Field label="Description" error={errors.description} hint="What this template is for. Shown in the template list.">
              {(ids) => <TextArea {...ids} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />}
            </Field>
          </div>
        </FormSection>
        <StarterGallery
          channel={channel}
          value={starter}
          onChange={(key, chosen) => {
            setStarter(key)
            if (chosen && !name.trim()) setName(chosen.name) // a sensible default the user can overwrite
            if (chosen && !description.trim()) setDescription(chosen.description)
          }}
        />
        {errors.starter && <p className="text-sm font-medium text-danger-text">{errors.starter}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={create.isPending} className={buttonPrimary}>
            {create.isPending && <Spinner className="h-4 w-4 border-brand-800 border-t-white" />}
            {['EMAIL', 'E_RECEIPT'].includes(channel) ? 'Create and open the designer' : 'Create and write the message'}
          </button>
          <Link to="/templates" className={buttonSecondary}>Cancel</Link>
        </div>
      </form>
    </section>
  )
}
