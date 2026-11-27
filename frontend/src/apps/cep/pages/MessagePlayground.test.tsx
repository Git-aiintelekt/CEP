/** The text editor's opt-out check: a message without opt-out words offers the Opt-Out Text tag, added at the end in one click. */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import MessagePlayground from './MessagePlayground'

afterEach(cleanup)

test('a message without opt-out words gets the Opt-Out Text tag at its end in one click, and the preview shows its words', async () => {
  const user = userEvent.setup()
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><MessagePlayground /></MemoryRouter></QueryClientProvider>)
  const message = screen.getByLabelText('Message') as HTMLTextAreaElement
  await user.type(message, 'Northwind: 20% off this weekend.')
  expect(screen.getByText(/No opt-out wording/).textContent).toContain('{{opt_out_text}}')
  message.setSelectionRange(0, 0)
  await user.click(screen.getByRole('button', { name: 'Add the Opt-Out Text' }))
  expect(message.value).toBe('Northwind: 20% off this weekend. {{opt_out_text}}')
  expect(screen.queryByText(/No opt-out wording/)).toBeNull()
  expect(screen.getAllByText(/Reply STOP to opt out/).length).toBeGreaterThan(0)
})

test('text pasted from a document lands in plain punctuation, says so, and Keep as Pasted puts it back as it was', async () => {
  const user = userEvent.setup()
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><MessagePlayground /></MemoryRouter></QueryClientProvider>)
  const message = screen.getByLabelText('Message') as HTMLTextAreaElement
  await user.click(message)
  await user.paste('It\u2019s our \u201cbig\u201d sale\u200b \u2014 today only.')
  expect(message.value).toBe('It\'s our "big" sale - today only.')
  expect(screen.getByText(/Changed 5 pasted characters/)).toBeTruthy()
  expect(screen.getByText('GSM-7')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Keep as Pasted' }))
  expect(message.value).toBe('It\u2019s our \u201cbig\u201d sale\u200b \u2014 today only.')
  expect(screen.queryByText(/Changed 5 pasted characters/)).toBeNull()
  expect(screen.getByText('UCS-2')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Use Plain Punctuation' })).toBeTruthy()
})

test('an MMS picture must be at least 600 × 600: a smaller upload is refused with its size, the picker leaves small ones out, a larger one is fine', async () => {
  const user = userEvent.setup()
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dev/message?channel=MMS']}><MessagePlayground /></MemoryRouter></QueryClientProvider>)
  expect(screen.getByText(/at least 600 × 600 pixels and up to 1 MB/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Choose from Library' }))
  expect(screen.getByRole('button', { name: 'Use lookbook.png' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Use sale.png' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Use thumbnail.png' })).toBeNull()

  const input = screen.getByLabelText('Upload a Picture')
  await user.upload(input, new File(['x'.repeat(2000)], 'small-400x300.png', { type: 'image/png' }))
  expect(await screen.findByText('The picture is 400 × 300 pixels. MMS pictures must be at least 600 × 600.')).toBeTruthy()
  expect(screen.getByText('No picture attached.')).toBeTruthy()

  await user.upload(input, new File(['x'.repeat(2000)], 'wide-1600x900.png', { type: 'image/png' }))
  expect(await screen.findByText('wide-1600x900.png')).toBeTruthy()
  expect(screen.queryByText('No picture attached.')).toBeNull()

  await user.upload(input, new File(['x'.repeat(1100 * 1024)], 'heavy-1200x1200.png', { type: 'image/png' }))
  expect(await screen.findByText(/MMS pictures can be at most 1 MB/)).toBeTruthy()
})
