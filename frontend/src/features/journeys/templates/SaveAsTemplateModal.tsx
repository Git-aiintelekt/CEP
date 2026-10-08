/** Save as Template, from a journey's page: snapshots one version (the live one, else the newest) into the workspace's own
 * template catalogue (POST /journey-templates/). The template never changes afterwards; journeys made from it say so. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/Button'
import { Counter, Field, Select, TextArea, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import type { Journey, JourneyTemplate, JourneyTemplateCategory } from '@/lib/types'

import { CATEGORIES, CATEGORY_META } from './templateMeta'
import { SAVED_TEMPLATES_KEY } from './templateApi'

const NAME_MAX = 200
const DESCRIPTION_MAX = 500

export function SaveAsTemplateModal({ journey, versionNumber, onClose }: { journey: Journey; versionNumber: number; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(journey.name.slice(0, NAME_MAX))
  const [category, setCategory] = useState<JourneyTemplateCategory>('LIFECYCLE')
  const [description, setDescription] = useState(journey.description ?? '')
  const save = useMutation({
    mutationFn: () => api.post<JourneyTemplate>('/journey-templates/', { journey_id: journey.id, version_number: versionNumber, name: name.trim(), category, description: description.trim() || null }),
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: SAVED_TEMPLATES_KEY })
      toast.success(`“${template.name}” is saved as a template. Find it under Your Templates on the Journeys page.`)
      onClose()
    },
  })
  const problem = save.error instanceof ApiError && save.error.status === 400 ? save.error.problem.errors : undefined
  const nameError = problem?.name ? String(Array.isArray(problem.name) ? problem.name[0] : problem.name) : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '' || save.isPending) return
    save.mutate()
  }
  return (
    <Modal title="Save as Template" subtitle={`Version ${versionNumber} of “${journey.name}”: its entry, steps and settings, as they are now.`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="save-as-template" type="submit" loading={save.isPending} disabled={name.trim() === ''}>Save Template</Button></>}>
      <form id="save-as-template" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Template Name" required error={nameError} limit={{ used: name.length, max: NAME_MAX }}>
          {(ids) => <TextInput {...ids} value={name} maxLength={NAME_MAX} autoFocus onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Category" required hint="Where it sits in the gallery.">
          {(ids) => (
            <Select {...ids} value={category} onChange={(event) => setCategory(event.target.value as JourneyTemplateCategory)}>
              {CATEGORIES.map((key) => <option key={key} value={key}>{CATEGORY_META[key].label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Description" labelEnd={<Counter used={description.length} max={DESCRIPTION_MAX} />}>
          {(ids) => <TextArea {...ids} value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="What the journey is for, for whoever copies it." />}
        </Field>
        <p className="text-helper text-ink-800">Message steps keep their templates and senders; anyone copying this template can change them. The journey itself is not affected.</p>
        {save.isError && !nameError && <p role="alert" className="text-sm font-medium text-danger-text">The template was not saved. {save.error instanceof Error ? save.error.message : ''}</p>}
      </form>
    </Modal>
  )
}
