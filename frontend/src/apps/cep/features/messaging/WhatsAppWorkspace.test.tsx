import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag, WhatsAppTemplate } from '@/lib/types'

import { WhatsAppWorkspace, type WhatsAppBackend } from './WhatsAppWorkspace'

const tag = (tag_key: string, label: string, sample_value: string, default_value: string | null = null): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['SMS', 'WHATSAPP'], description: null, sample_value,
  default_value, static_value: null, is_active: true,
})
const TAGS = [tag('first_name', 'First Name', 'Mei Ling', 'there'), tag('preferred_store', 'Preferred Store', 'Harbour Mall')]
const NUMBERS = [{ engine: 'wa-1', label: '+6568124400 · City HT', name: 'City HT' }]

const draft = (over: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate => ({
  template: 't1', name: 'Weekend Offer', status: 'DRAFT', version_number: 1, engine: 'wa-1', engine_name: 'City HT WhatsApp', meta_name: 'weekend_offer', language: 'en',
  category: 'MARKETING', header_type: 'NONE', header_text: '', header_media: null, body: 'Hi {{first_name}}, 20% off at {{preferred_store}} this weekend.',
  meta_body: 'Hi {{1}}, 20% off at {{2}} this weekend.', footer_text: 'Reply STOP to opt out', buttons: [{ type: 'QUICK_REPLY', text: 'Stop Offers' }],
  variables: [{ tag: 'first_name', sample: 'Mei Ling', fallback: '' }, { tag: 'preferred_store', sample: 'Harbour Mall', fallback: 'any City HT store' }],
  origin: 'CEP', meta_status: 'DRAFT', meta_reason: null, meta_quality: null, meta_template_id: null, submitted_at: null, decided_at: null, synced_at: null,
  editable: true, row_version: 1,
  findings: { characters: 40, max_characters: 1024, tags_used: ['first_name', 'preferred_store'], unknown_tags: [], starts_or_ends_with_tag: false, adjacent_tags: false,
              too_many_tags: false, missing_opt_out: false },
  ...over,
})

function backend(over: Partial<WhatsAppBackend> = {}): WhatsAppBackend {
  return {
    save: vi.fn(async (input) => draft({ version_number: 2, body: input.body, footer_text: input.footer_text, buttons: input.buttons })),
    submit: vi.fn(async () => draft({ meta_status: 'PENDING', editable: false, submitted_at: '2026-11-05T02:00:00Z', meta_template_id: '9001' })),
    activate: vi.fn(async () => undefined),
    copy: vi.fn(async () => 't2'),
    uploadMedia: vi.fn(),
    ...over,
  }
}

function open(template: WhatsAppTemplate, api: WhatsAppBackend, onCopied = vi.fn()) {
  render(
    <MemoryRouter>
      <WhatsAppWorkspace templateName={template.name} status={template.status} template={template} tags={TAGS} numbers={NUMBERS} backend={api} backTo="/templates" onCopied={onCopied} />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

test('a draft previews with its samples, says Meta has not seen it, and saves Meta’s parts with a sample and a fallback per tag', async () => {
  const api = backend()
  const user = userEvent.setup()
  open(draft(), api)

  expect(screen.getByTestId('whatsapp-preview').textContent).toContain('Hi Mei Ling, 20% off at Harbour Mall this weekend.')
  expect(screen.getByTestId('whatsapp-review').textContent).toContain('Not with Meta yet.')
  expect(screen.getByText('Not Submitted')).toBeTruthy()
  expect(screen.getByText('Stop Offers')).toBeTruthy()

  await user.clear(screen.getByLabelText('If preferred_store is empty'))
  await user.type(screen.getByLabelText('If preferred_store is empty'), 'your nearest store')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  expect(vi.mocked(api.save).mock.calls[0][0]).toMatchObject({
    engine: 'wa-1', meta_name: 'weekend_offer', category: 'MARKETING', body: 'Hi {{first_name}}, 20% off at {{preferred_store}} this weekend.',
    samples: { first_name: 'Mei Ling', preferred_store: 'Harbour Mall' }, fallbacks: { first_name: '', preferred_store: 'your nearest store' }, base_version: 1,
  })
  expect((await screen.findByRole('status')).textContent).toContain('Saved as version 2')
})

test('what Meta would refuse is named before saving: a tag at the end, two tags side by side, no way to stop marketing', async () => {
  const user = userEvent.setup()
  open(draft({ footer_text: '', buttons: [] }), backend())
  const body = screen.getByLabelText(/^Body/)

  await user.clear(body)
  await user.type(body, 'Your store is {{{{preferred_store}}')
  expect(screen.getByText(/starts or ends with a tag/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

  await user.clear(body)
  await user.type(body, 'Hi {{{{first_name}} {{{{preferred_store}} is open.')
  expect(screen.getByText(/two tags side by side/)).toBeTruthy()

  await user.clear(body)
  await user.type(body, 'Hi {{{{first_name}}, our sale starts today.')
  expect(screen.queryByText('Meta Would Refuse This')).toBeNull()
  expect(screen.getByText(/No way to stop marketing messages/)).toBeTruthy()
})

test('Submit to Meta sends the saved version and the template waits in review; one in review offers only a copy', async () => {
  const api = backend()
  const user = userEvent.setup()
  open(draft(), api)

  await user.click(screen.getByRole('button', { name: 'Submit to Meta' }))
  await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
  expect((await screen.findByRole('status')).textContent).toContain('Sent to Meta for review')
  expect(screen.getByText('In Review')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Submit to Meta' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy to Change' })).toBeTruthy()
})

test('an approved template is read-only: its words are what Meta approved, and Copy to Change opens a draft copy', async () => {
  const api = backend()
  const onCopied = vi.fn()
  const user = userEvent.setup()
  open(draft({ meta_status: 'APPROVED', editable: false, status: 'ACTIVE' }), api, onCopied)

  expect(screen.getByTestId('whatsapp-review').textContent).toContain('Approved by Meta.')
  expect((screen.getByLabelText(/^Body/) as HTMLTextAreaElement).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Copy to Change' }))
  await waitFor(() => expect(onCopied).toHaveBeenCalledWith('t2'))
})

test('a rejected template shows Meta’s reason and can be changed again', () => {
  open(draft({ meta_status: 'REJECTED', meta_reason: 'INVALID_FORMAT', meta_template_id: '9001' }), backend())
  expect(screen.getByTestId('whatsapp-review').textContent).toContain('Meta’s reason: INVALID_FORMAT')
  expect((screen.getByLabelText(/^Body/) as HTMLTextAreaElement).disabled).toBe(false)
})

test('a template made in WhatsApp Manager keeps Meta’s words; the tag of each number is chosen and saved', async () => {
  const api = backend({ save: vi.fn(async () => draft({ origin: 'META', meta_status: 'APPROVED', editable: false })) })
  const user = userEvent.setup()
  open(draft({ origin: 'META', meta_status: 'APPROVED', editable: false, variables: [{ tag: '', sample: 'Mei', fallback: '' }, { tag: '', sample: 'Harbour Mall', fallback: '' }] }), api)

  expect(screen.getByTestId('whatsapp-review').textContent).toContain('Made in WhatsApp Manager.')
  expect((screen.getByLabelText(/^Body/) as HTMLTextAreaElement).value).toBe('Hi {{1}}, 20% off at {{2}} this weekend.')
  expect(screen.getByTestId('whatsapp-preview').textContent).toContain('Hi Mei, 20% off at Harbour Mall this weekend.')
  await user.selectOptions(screen.getByLabelText('Tag for {{1}}'), 'first_name')
  await user.selectOptions(screen.getByLabelText('Tag for {{2}}'), 'preferred_store')
  await user.type(screen.getByLabelText('If {{2}} is empty'), 'our stores')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  expect(vi.mocked(api.save).mock.calls[0][0]).toMatchObject({ variable_tags: ['first_name', 'preferred_store'], fallbacks: { 1: '', 2: 'our stores' } })
})
