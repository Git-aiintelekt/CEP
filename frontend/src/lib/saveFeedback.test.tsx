import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { SaveTick } from '@/components/SaveTick'

import { ApiError } from './api'
import { failureText, saveFailure } from './saveFeedback'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const problem = (status: number, body: Record<string, unknown> = {}) => new ApiError(status, { type: 'about:blank', status, title: 'x', ...body })

test('no connection: CEP could not be reached, the entries kept, a warning not an error', () => {
  const failed = saveFailure(problem(0, { detail: 'CEP could not be reached. Check your connection and try again.' }), 'The campaign was not saved')
  expect(failed).toMatchObject({ title: 'CEP could not be reached', tone: 'warning', short: 'Check your connection and try again.' })
  expect(failed.detail).toBe('The campaign was not saved. Your changes are still here; check your connection and try again.')
})

test('CEP’s own problem: the time, what to do and the reference, never the server’s words', () => {
  const failed = saveFailure(problem(500, { title: 'Internal Server Error', reference: 'ER-42', at: '2026-10-06T14:32:00Z' }), 'The sender was not saved')
  expect(failed.title).toBe('The sender was not saved')
  expect(failed.reference).toBe('ER-42')
  expect(failed.detail).toMatch(/^CEP had a problem at \d{1,2}:\d{2} [AP]M\. Your entries are still here; try again\. If it happens again, give your administrator the reference ER-42\.$/)
  expect(failed.short).toMatch(/^CEP had a problem at .+\. Try again\.$/)
  expect(JSON.stringify(failed)).not.toContain('Internal Server Error')
  expect(saveFailure(problem(502), 'The sender was not saved').detail).toContain('tell your administrator')
})

test('a refused form: shown fields on their field, everything else in the banner; no "Invalid input"', () => {
  const error = problem(400, { title: 'Invalid input', errors: { name: ['Another template is already called “Fall”.'], non_field_errors: ['An active template cannot be renamed'], hidden: ['Not on this form.'] } })
  const failed = saveFailure(error, 'The template was not renamed', ['name'])
  expect(failed.title).toBe('Check the highlighted fields')
  expect(failed.detail).toBe('The template was not renamed.')
  expect(failed.fields).toEqual({ name: 'Another template is already called “Fall”.' })
  expect(failed.general).toEqual(['An active template cannot be renamed.', 'Not on this form.'])
  const listed = saveFailure(problem(400, { errors: ['A list-shaped refusal'] }), 'The list was not saved')
  expect(listed).toMatchObject({ title: 'The list was not saved', detail: 'A list-shaped refusal.' })
  expect(failureText(error)).toBe('Another template is already called “Fall”. Not on this form. An active template cannot be renamed.')
})

test('no permission, a conflict, the database busy and a mistake in the page each say what to do', () => {
  expect(saveFailure(problem(403, { detail: 'You do not have permission to perform this action.' }), 'The role was not saved').detail)
    .toBe('You do not have permission to do this. Ask a workspace administrator.')
  expect(saveFailure(problem(403, { detail: 'Journeys is not part of this workspace.' }), 'x').detail).toBe('Journeys is not part of this workspace.')
  expect(saveFailure(problem(409, { detail: 'Someone else changed this template after you opened it' }), 'x').detail).toBe('Someone else changed this template after you opened it.')
  expect(saveFailure(problem(503, { detail: 'CEP’s database is not answering.' }), 'x')).toMatchObject({ tone: 'warning', detail: 'CEP’s database is not answering. Your entries are still here; try again in a minute.' })
  expect(saveFailure(new TypeError('Cannot read properties of undefined'), 'The tag was not saved').detail).toBe('Your entries are still here; try again. If it happens again, tell your administrator.')
})

function Switch({ fail }: { fail: boolean }) {
  const save = useMutation({ mutationFn: async (body: Record<string, unknown>) => { if (fail) throw problem(500); return body } })
  return (
    <div>
      <button type="button" onClick={() => save.mutate({ click_days: 14 })}>Change Click Window</button>
      <span data-testid="click"><SaveTick mutation={save} field="click_days" /></span>
      <span data-testid="open"><SaveTick mutation={save} field="open_days" /></span>
    </div>
  )
}

test('the tick answers beside the control that changed, fades after two seconds, and offers Try again when it failed', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<QueryClientProvider client={new QueryClient()}><Switch fail={false} /></QueryClientProvider>)
  await user.click(screen.getByRole('button', { name: 'Change Click Window' }))
  const click = screen.getByTestId('click').firstElementChild as HTMLElement
  await vi.waitFor(() => expect(click.className).toContain('opacity-100'))
  expect(click.textContent).toContain('Saved')
  expect((screen.getByTestId('open').firstElementChild as HTMLElement).className).toContain('invisible')      // the other control stays quiet
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)) })
  expect((screen.getByTestId('click').firstElementChild as HTMLElement).className).toContain('opacity-45')

  rerender(<QueryClientProvider client={new QueryClient()}><Switch fail /></QueryClientProvider>)
  await user.click(screen.getByRole('button', { name: 'Change Click Window' }))
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.getByTestId('click').textContent).toContain('Not saved')
})
