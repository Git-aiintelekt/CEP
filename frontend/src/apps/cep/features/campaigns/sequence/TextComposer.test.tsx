/** The drip editor's text: why a message is Unicode, Use Plain Punctuation, and plain punctuation on paste. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test } from 'vitest'

import { TextComposer } from './TextMessage'

afterEach(cleanup)

function Composer({ start }: { start: string }) {
  const [draft, setDraft] = useState(start)
  return <TextComposer draft={draft} onDraft={setDraft} mms={false} sender="ZS Shop" imageUrl={null} when="Day 0, 09:00" />
}

function renderComposer(start: string) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['personalization-tags', 'all'], { count: 0, next: null, previous: null, results: [] })
  render(<QueryClientProvider client={client}><Composer start={start} /></QueryClientProvider>)
  return screen.getByLabelText('Message Text') as HTMLTextAreaElement
}

test('a curly apostrophe says why the text is Unicode, and Use Plain Punctuation brings it back to 160 a part', async () => {
  const user = userEvent.setup()
  const area = renderComposer('We\u2019ve saved you a seat. Reply STOP to opt out.')
  expect(screen.getByText(/now Unicode because of \u2019 \(U\+2019\): 70 characters a part instead of 160/)).toBeTruthy()
  expect(screen.getByText(/\/ 70 ·/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Use Plain Punctuation' }))
  expect(area.value).toBe('We\'ve saved you a seat. Reply STOP to opt out.')
  expect(screen.getByText(/\/ 160 ·/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Use Plain Punctuation' })).toBeNull()
})

test('a paste lands in plain punctuation, with Keep as Pasted', async () => {
  const user = userEvent.setup()
  const area = renderComposer('')
  await user.click(area)
  await user.paste('Doors open at 9\u2009am \u2013 don\u2019t miss it')
  expect(area.value).toBe('Doors open at 9 am - don\'t miss it')
  expect(screen.getByText(/Changed 3 pasted characters/)).toBeTruthy()
})
