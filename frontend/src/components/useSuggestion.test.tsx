import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, expect, test, vi } from 'vitest'

import { Modal } from './Modal'
import { TextArea, TextInput } from './Form'

afterEach(cleanup)

function Controlled({ suggestion, start = '' }: { suggestion: string | null; start?: string }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <TextInput aria-label="Name" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. Fall Promo" suggestion={suggestion} />
      <TextInput aria-label="Next" />
    </>
  )
}

test('Tab puts the suggestion in an empty box and keeps the cursor there, at the end', async () => {
  const user = userEvent.setup()
  render(<Controlled suggestion="Welcome Email, Nov 2026" />)
  const box = screen.getByLabelText('Name') as HTMLInputElement
  expect(box.placeholder).toBe('Welcome Email, Nov 2026')
  expect(box.getAttribute('aria-describedby')).toBeTruthy()
  expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('Suggestion: Welcome Email, Nov 2026. Press Tab to use it.')
  await user.click(box)
  await user.tab()
  expect(box.value).toBe('Welcome Email, Nov 2026')
  expect(document.activeElement).toBe(box)
  expect(box.selectionStart).toBe(box.value.length)
  expect(document.querySelector('[data-suggestion-said]')?.textContent).toBe('Suggestion used')
  await user.tab()                                                                   // once it has text, Tab moves on
  expect(document.activeElement).toBe(screen.getByLabelText('Next'))
})

test('Tab moves on when the box has text; Shift+Tab never takes it; the right arrow does', async () => {
  const user = userEvent.setup()
  render(<Controlled suggestion="Welcome Email, Nov 2026" start="Mine" />)
  const box = screen.getByLabelText('Name') as HTMLInputElement
  await user.click(box)
  await user.tab()
  expect(box.value).toBe('Mine')
  expect(document.activeElement).toBe(screen.getByLabelText('Next'))
  cleanup()

  render(<Controlled suggestion="Welcome Email, Nov 2026" />)
  const fresh = screen.getByLabelText('Name') as HTMLInputElement
  await user.click(fresh)
  await user.tab({ shift: true })
  expect(fresh.value).toBe('')
  await user.click(fresh)
  await user.keyboard('{ArrowRight}')
  expect(fresh.value).toBe('Welcome Email, Nov 2026')
})

test('no suggestion: the box keeps its own hint and Tab moves on', async () => {
  const user = userEvent.setup()
  render(<Controlled suggestion={null} />)
  const box = screen.getByLabelText('Name') as HTMLInputElement
  expect(box.placeholder).toBe('e.g. Fall Promo')
  expect(document.querySelector('[data-suggestion-tag]')).toBeNull()
  await user.click(box)
  await user.tab()
  expect(box.value).toBe('')
  expect(document.activeElement).toBe(screen.getByLabelText('Next'))
})

test('a react-hook-form box takes it too, and the tag can be clicked', async () => {
  const submitted = vi.fn()
  function Form() {
    const { register, handleSubmit } = useForm({ defaultValues: { name: '' } })
    return (
      <form onSubmit={handleSubmit((values) => submitted(values.name))}>
        <TextInput aria-label="Name" {...register('name')} suggestion="Drip SMS, Nov 2026" />
        <button type="submit">Save</button>
      </form>
    )
  }
  const user = userEvent.setup()
  render(<Form />)
  const box = screen.getByLabelText('Name') as HTMLInputElement
  await user.click(box)
  fireEvent.click(document.querySelector('[data-suggestion-tag]')!)
  expect(box.value).toBe('Drip SMS, Nov 2026')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(submitted).toHaveBeenCalledWith('Drip SMS, Nov 2026')
})

test('a text area can leave the cursor at the start, above a line meant to stay last', async () => {
  function Area() {
    const [value, setValue] = useState('')
    return <TextArea aria-label="Message" value={value} onChange={(event) => setValue(event.target.value)} suggestion={'\nReply STOP to opt out.'} suggestionCursor="start" />
  }
  const user = userEvent.setup()
  render(<Area />)
  const area = screen.getByLabelText('Message') as HTMLTextAreaElement
  await user.click(area)
  await user.tab()
  expect(area.value).toBe('\nReply STOP to opt out.')
  expect(area.selectionStart).toBe(0)
  await user.keyboard('Your reward is in.')
  expect(area.value).toBe('Your reward is in.\nReply STOP to opt out.')
})

test('in a dialog, Tab on the last box takes the suggestion instead of going round to the first', async () => {
  function Dialog() {
    const [value, setValue] = useState('')
    return (
      <Modal title="New" onClose={() => {}}>
        <TextInput aria-label="First" />
        <TextInput aria-label="Last" value={value} onChange={(event) => setValue(event.target.value)} suggestion="Welcome Email, Nov 2026" />
      </Modal>
    )
  }
  const user = userEvent.setup()
  render(<Dialog />)
  const last = screen.getByLabelText('Last') as HTMLInputElement
  await user.click(last)
  await user.tab()
  expect(last.value).toBe('Welcome Email, Nov 2026')
  expect(document.activeElement).toBe(last)
})
