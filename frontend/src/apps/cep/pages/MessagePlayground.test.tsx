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
