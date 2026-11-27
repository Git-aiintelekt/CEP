/** A campaign message's picture (the message drawer): an upload under 600 × 600 is refused with its size and not attached. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import type { MediaAsset, Message } from '@/lib/types'

import { TextView } from './TextMessage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const MESSAGE = {
  template: 't1', channel: 'MMS', version_number: 1, latest_version: 1, sms_body: 'Our new range is in. Reply STOP to opt out.', subject_line: '', media_asset: null,
  saved_at: null, saved_by: null, findings: {},
} as unknown as Message

const asset = (file_name: string, width_px: number, height_px: number): MediaAsset => ({
  id: file_name, file_name, mime_type: 'image/png', byte_size: 200_000, width_px, height_px, url: `https://cdn.example/${file_name}`, created_at: '2026-11-27T00:00:00Z',
})

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['templates', 'message', 't1'], MESSAGE)
  client.setQueryData(['personalization-tags', 'all'], { count: 0, next: null, previous: null, results: [] })
  render(<QueryClientProvider client={client}><TextView campaignId="c1" templateId="t1" mms onEdit={() => undefined} /></QueryClientProvider>)
}

test('a picture under 600 × 600 is refused with its size; a larger one is saved on the message', async () => {
  const calls = { upload: vi.spyOn(api, 'upload'), post: vi.spyOn(api, 'post') }
  const user = userEvent.setup()
  open()
  expect(screen.getByText(/at least 600 × 600 pixels and up to 1 MB/)).toBeTruthy()

  calls.upload.mockResolvedValueOnce(asset('small.png', 500, 700))
  await user.upload(screen.getByLabelText('Upload an Image'), new File(['x'], 'small.png', { type: 'image/png' }))
  expect(await screen.findByText('The picture is 500 × 700 pixels. MMS pictures must be at least 600 × 600.')).toBeTruthy()
  expect(calls.post).not.toHaveBeenCalled()

  calls.upload.mockResolvedValueOnce(asset('large.png', 1200, 900))
  calls.post.mockResolvedValueOnce({ ...MESSAGE, latest_version: 2, media_asset: asset('large.png', 1200, 900) })
  await user.upload(screen.getByLabelText('Upload an Image'), new File(['x'], 'large.png', { type: 'image/png' }))
  await vi.waitFor(() => expect(calls.post).toHaveBeenCalledWith('/templates/t1/message/', expect.objectContaining({ media_asset: 'large.png' })))
})
