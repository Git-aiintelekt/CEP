/**
 * Change a day of the Delivery Warm-Up: its lists, its template and its hourly limit, for that day only or for it and the
 * days after it. Today's change applies from the next hour; days already sent cannot change. The From address is not
 * offered: a new one would start the warm-up again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { problemText } from '@/apps/cep/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ContactList, Template, WarmUp, WarmUpDay, WarmUpOverview } from '@/lib/types'

import { WARM_UP_KEY, dayLabel } from './warmUpWords'

export function ChangeDayDialog({ warmUp, day, days, lists, templates, onClose }: {
  warmUp: WarmUp; day: WarmUpDay; days: WarmUpDay[]; lists: ContactList[]; templates: Template[]; onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [listIds, setListIds] = useState(day.lists.map((list) => list.id))
  const [templateId, setTemplateId] = useState(day.template?.id ?? '')
  const [hourly, setHourly] = useState(String(day.hourly_limit))
  const [toDay, setToDay] = useState(day.day)
  const today = day.day === warmUp.current_day
  const save = useMutation({
    mutationFn: () => api.post<WarmUpOverview>('/warmup/days/', {
      from_day: day.day, to_day: toDay, list_ids: listIds, template_id: templateId,
      ...(Number(hourly) !== day.hourly_limit ? { hourly_limit: Number(hourly) } : {}),
    }),
    onSuccess: (next) => { queryClient.setQueryData(WARM_UP_KEY, next); onClose() },
  })
  const people = lists.filter((list) => listIds.includes(list.id)).reduce((sum, list) => sum + list.member_count, 0)
  const later = days.filter((item) => item.day > day.day)
  const limitOk = /^\d+$/.test(hourly) && Number(hourly) >= 1
  const ready = listIds.length > 0 && Boolean(templateId) && limitOk && !save.isPending

  return (
    <Modal title={`Change Day ${day.day}`} subtitle={`${dayLabel(day.date)} · ${formatNumber(day.daily_limit)} a day`} onClose={onClose} scrollBody
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={buttonPrimary} disabled={!ready} onClick={() => save.mutate()}>{toDay > day.day ? `Save Days ${day.day} to ${toDay}` : `Save Day ${day.day}`}</button>
      </>}>
      <div className="flex flex-col gap-5">
        {today && <Notice>Today is day {day.day}: the change applies from the next hour. What went out already stays as it was.</Notice>}
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">Lists</legend>
          <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-label="Lists">
            {lists.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                <Checkbox checked={listIds.includes(list.id)} label={list.name} className="text-sm"
                  onChange={(event) => { const { checked } = event.target; setListIds((current) => (checked ? [...current, list.id] : current.filter((id) => id !== list.id))) }} />
                <span className="cep-num shrink-0 text-helper text-ink-800">{formatNumber(list.member_count)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-helper text-ink-800">
            {listIds.length ? `${formatNumber(people)} people in the chosen lists, before duplicates and opt-outs.` : 'Choose at least one list.'}
            {' '}The people come in list order, the most engaged first; everyone is reached once before anyone twice.
          </p>
        </fieldset>
        <Field label="Template" hint="An email template with saved content. Someone who already had it gets the next template they have not had.">
          {(ids) => <Select {...ids} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Choose a template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </Select>}
        </Field>
        <Field label="Hourly Limit" hint={`${warmUp.plan_kind === 'DAILY' ? `Over ${warmUp.window_hours} hours from ${warmUp.window_start}` : 'Round the clock'}: ${limitOk ? formatNumber(Number(hourly) * warmUp.window_hours) : '—'} a day.`}
          error={limitOk ? undefined : 'A whole number, at least 1.'}>
          {(ids) => <TextInput {...ids} inputMode="numeric" value={hourly} invalid={!limitOk} onChange={(event) => setHourly(event.target.value.trim())} className="max-w-40" />}
        </Field>
        <Field label="Apply To">
          {(ids) => <Select {...ids} value={String(toDay)} onChange={(event) => setToDay(Number(event.target.value))}>
            <option value={day.day}>Day {day.day} Only</option>
            {later.map((item) => <option key={item.day} value={item.day}>Days {day.day} to {item.day}{item.day === days[days.length - 1]?.day ? ' (the End)' : ''}</option>)}
          </Select>}
        </Field>
        <p className="text-helper text-ink-800">The From address stays {warmUp.sender.from_address ?? 'as it is'}: a new sender or domain would start the warm-up again.</p>
        {save.isError && <Notice tone="error">{problemText(save.error)}</Notice>}
      </div>
    </Modal>
  )
}
