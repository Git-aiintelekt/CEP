import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest'

import { ToastProvider } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import type { Design, PersonalizationTag, ReceiptLayout } from '@/lib/types'
import { fakeCanvas, resetFakeCanvas } from '@/test/fakeCanvas'
import { makeDesign, makeReceiptLayout } from '@/test/mockApi'

import { ReceiptWorkspace, type ReceiptBackend } from './ReceiptWorkspace'
import { COMBINED_FRAME_TITLE } from './PreviewTestPane'
import { conflictNote, olderNote } from './receiptWorkspaceCopy'

// GrapesJS needs a real browser layout engine; the canvas is checked in the browser playground (/dev/receipt)
vi.mock('./OuterDesignPane', () => import('@/test/fakeOuterDesignPane'))

const TAGS: PersonalizationTag[] = [{
  id: 'first_name', tag_key: 'first_name', label: 'First name', tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['E_RECEIPT'],
  description: null, sample_value: 'Jordan', default_value: 'there', static_value: null, is_active: true,
}]

/** Every method a vitest mock, so a test can read its calls and change its answers. */
type MockBackend = { [K in keyof Required<ReceiptBackend>]: Mock<NonNullable<ReceiptBackend[K]>> }

function makeBackend(over: Partial<ReceiptBackend> = {}): MockBackend {
  return {
    saveDesign: vi.fn(async (input) => makeDesign({ ...input, version_number: input.base_version + 1, latest_version: input.base_version + 1 }) as Design),
    loadDesignVersion: vi.fn(async (version: number) => makeDesign({ version_number: version, latest_version: 2, mjml_source: `<mjml><mj-body>v${version}</mj-body></mjml>` })),
    listDesignVersions: vi.fn(async () => [{ version_number: 1, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }]),
    saveReceiptLayout: vi.fn(async (input) => makeReceiptLayout({ ...input, version_number: input.base_version + 1, latest_version: input.base_version + 1 })),
    loadReceiptLayoutVersion: vi.fn(async (version: number) => makeReceiptLayout({ version_number: version, latest_version: 2, layout_preset: 'COMPACT' })),
    listReceiptLayoutVersions: vi.fn(async () => [{ version_number: 1, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }]),
    uploadAsset: vi.fn(async (file: File) => ({ url: 'blob:x', name: file.name })),
    activate: vi.fn(async () => {}),
    ...over,
  } as MockBackend
}

function setup({ backend = makeBackend(), readOnly = false, status = 'DRAFT', layout = makeReceiptLayout() }: { backend?: ReceiptBackend; readOnly?: boolean; status?: string; layout?: ReceiptLayout } = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ToastProvider>
        <ReceiptWorkspace templateName="Northline order receipt" status={status} design={makeDesign()} receiptLayout={layout} tags={TAGS} assets={[]} backend={backend} backTo="/templates" readOnly={readOnly} />
      </ToastProvider>
    </MemoryRouter>,
  )
  return { user, backend: backend as MockBackend }
}

const note = () => document.querySelector('header .cep-num')?.textContent ?? ''
const tab = (name: string) => screen.getByRole('tab', { name })
const save = () => screen.getByRole('button', { name: 'Save draft' })
const hideLoyalty = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('switch', { name: 'Show Loyalty' }))
const removeFooter = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Remove the footer' }))

beforeEach(resetFakeCanvas)
afterEach(cleanup)

test('opens on the outer design, with three tabs and both parts\' versions', () => {
  setup()
  expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual(['Outer design', 'Receipt layout', 'Preview & test'])
  expect(tab('Outer design').getAttribute('aria-selected')).toBe('true')
  expect(note()).toContain('Outer design v1 · receipt layout v1')
  expect(note()).not.toContain('unsaved')
  expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
})

test('a change in any mode makes the whole editor unsaved', async () => {
  const { user } = setup()
  await removeFooter(user)
  expect(note()).toContain('unsaved changes')

  cleanup()
  resetFakeCanvas()
  const second = setup()
  await second.user.click(tab('Receipt layout'))
  await hideLoyalty(second.user)
  expect(note()).toContain('unsaved changes')
  // switching it back is no change at all: the layout is compared, not merely touched
  await hideLoyalty(second.user)
  expect(note()).not.toContain('unsaved changes')
})

test('Save saves both parts, says so once, and leaves nothing unsaved', async () => {
  const { user, backend } = setup()
  await removeFooter(user)
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(save())

  await waitFor(() => expect(note()).toContain('Outer design v2 · receipt layout v2'))
  expect(backend.saveDesign).toHaveBeenCalledWith(expect.objectContaining({ base_version: 1, subject_line: 'Your Northline receipt', mjml_source: fakeCanvas.mjml }))
  const layout = backend.saveReceiptLayout.mock.calls[0][0]
  expect(layout.base_version).toBe(1)
  expect(layout.sections.find((section) => section.key === 'loyalty')?.visible).toBe(false)
  expect(note()).not.toContain('unsaved')
  expect(screen.getAllByText('Outer design version 2 · receipt layout version 2')).toHaveLength(1)
})

test('a change to one part saves that part alone', async () => {
  const { user, backend } = setup()
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(save())

  await waitFor(() => expect(note()).toContain('Outer design v1 · receipt layout v2'))
  expect(backend.saveDesign).not.toHaveBeenCalled()
  expect(backend.saveReceiptLayout).toHaveBeenCalledTimes(1)
})

test('with nothing changed, Save saves both, as the email designer does', async () => {
  const { user, backend } = setup()
  await user.click(save())
  await waitFor(() => expect(backend.saveReceiptLayout).toHaveBeenCalledTimes(1))
  expect(backend.saveDesign).toHaveBeenCalledTimes(1)
})

test('a conflict on the outer design names it, while the layout still saves', async () => {
  const backend = makeBackend({ saveDesign: vi.fn(async () => Promise.reject(new ApiError(409, { title: 'Conflict', detail: 'Someone else saved.' }))) })
  const { user } = setup({ backend })
  await removeFooter(user)
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(save())

  expect(await screen.findByText(conflictNote('Outer design'))).toBeTruthy()
  expect(screen.queryByText(conflictNote('Receipt layout'))).toBeNull()
  await waitFor(() => expect(note()).toContain('receipt layout v2'))
  // the design's changes are still unsaved; the layout's are not
  expect(note()).toContain('Outer design v1')
  expect(note()).toContain('unsaved changes')
})

test('a conflict on the receipt layout names the layout', async () => {
  const backend = makeBackend({ saveReceiptLayout: vi.fn(async () => Promise.reject(new ApiError(409, { title: 'Conflict', detail: 'Someone else saved.' }))) })
  const { user } = setup({ backend })
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(save())
  expect(await screen.findByText(conflictNote('Receipt layout'))).toBeTruthy()
  expect(screen.queryByText(conflictNote('Outer design'))).toBeNull()
})

test('a refused design is explained, with the server\'s words', async () => {
  const backend = makeBackend({ saveDesign: vi.fn(async () => Promise.reject(new ApiError(400, { title: 'Invalid', errors: { mjml_source: ['Scripts are not allowed.'] } }))) })
  const { user } = setup({ backend })
  await removeFooter(user)
  await user.click(save())
  expect(await screen.findByText('The outer design cannot be saved yet')).toBeTruthy()
})

test('Activate waits for a save, then activates', async () => {
  const { user, backend } = setup()
  await removeFooter(user)
  expect(screen.getByRole('button', { name: 'Activate' }).getAttribute('aria-disabled')).toBe('true')

  await user.click(save())
  await waitFor(() => expect(note()).not.toContain('unsaved'))
  await user.click(screen.getByRole('button', { name: 'Activate' }))
  await waitFor(() => expect(backend.activate).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('Template activated')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
})

test('leaving with unsaved work asks first', async () => {
  const { user } = setup()
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(screen.getByRole('link', { name: 'Back to templates' }))
  expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeTruthy()
})

test('switching tabs never remounts the canvas or loses the layout\'s selection', async () => {
  const { user } = setup()
  await user.click(tab('Receipt layout'))
  await user.click(screen.getByRole('button', { name: 'Payment' }))
  await user.click(tab('Preview & test'))
  await user.click(tab('Outer design'))
  await user.click(tab('Receipt layout'))

  expect(fakeCanvas.mounts).toBe(1)
  expect(screen.getByRole('button', { name: 'Payment' }).getAttribute('aria-pressed')).toBe('true')
})

test('the slot\'s Open Receipt layout switches to that tab', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Open Receipt layout' }))
  expect(tab('Receipt layout').getAttribute('aria-selected')).toBe('true')
})

test('Preview & test shows the real outer email with the receipt in its slot, and its head carries the phone rule', async () => {
  const { user } = setup()
  await user.click(tab('Receipt layout'))
  await hideLoyalty(user)
  await user.click(tab('Preview & test'))

  const frame = (await screen.findByTitle(COMBINED_FRAME_TITLE)) as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('')
  const html = frame.getAttribute('srcdoc') ?? ''
  expect(html).toContain('YOUR BRAND')
  expect(html).toContain('data-section="totals"')
  expect(html).not.toContain('data-section="loyalty"')
  expect(html).not.toContain('<p>placeholder</p>')
  expect(html).toMatch(/<style>@media[^<]*cep-hide-mobile[^<]*<\/style><\/head>/)
  expect(screen.queryByTestId('outer-email')).toBeNull()
})

test('the footer check follows the canvas: remove the footer and it fails', async () => {
  const { user } = setup()
  const status = () => (document.querySelector('[data-check="sender-address"]') as HTMLElement).dataset.status
  expect(status()).toBe('pass')

  await removeFooter(user)
  await waitFor(() => expect(status()).toBe('fail'), { timeout: 5000 })
  expect(await screen.findByText('1 of 5 checks to fix · see Preview & test.')).toBeTruthy()
})

test('an older version of one part is loaded on its own, and says which part it is', async () => {
  const { user, backend } = setup({ layout: makeReceiptLayout({ version_number: 2, latest_version: 2 }) })
  backend.listReceiptLayoutVersions.mockResolvedValue([
    { version_number: 2, saved_at: '2026-09-03T10:00:00Z', saved_by: 'Aby John' },
    { version_number: 1, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' },
  ])
  await user.click(screen.getByRole('button', { name: /Layout history/ }))
  const menu = await screen.findByRole('region', { name: 'Receipt layout versions' })
  await user.click(within(menu).getByRole('button', { name: 'Load' }))

  await waitFor(() => expect(backend.loadReceiptLayoutVersion).toHaveBeenCalledWith(1))
  expect(await screen.findByText(olderNote('Receipt layout', 1))).toBeTruthy()
  expect(backend.loadDesignVersion).not.toHaveBeenCalled()
  expect(note()).toContain('receipt layout v1 of 2')
})

test('read-only: a strip says so, and there is nothing to save or activate', () => {
  setup({ readOnly: true })
  expect(screen.getByText('You can view this template but not edit it')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
})
