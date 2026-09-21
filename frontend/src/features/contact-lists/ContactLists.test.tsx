import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const csv = () => new File(['Email Address,First Name,Notes\na@x.example,Ana,vip\n'], 'leads.csv', { type: 'text/csv' })

test('browse: totals, every list with its type, source and use; search and the Type / Source filters go to the API', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')

  const totals = await screen.findByLabelText('Contact list totals')
  await vi.waitFor(() => expect(within(totals).getByText('Total lists').nextElementSibling?.textContent).toBe('2'))
  expect(within(totals).getByText('Attached to live campaigns').nextElementSibling?.textContent).toBe('1')

  const table = await screen.findByRole('table', { name: 'Contact Lists' })
  const master = within(table).getByText('Fall Master Audience').closest('tr') as HTMLElement
  expect(within(master).getByText('Production')).toBeTruthy()
  expect(within(master).getByText('Upload')).toBeTruthy()
  expect(within(master).getByText('2 · 1 live')).toBeTruthy()
  const georgia = within(table).getByText('Georgia only').closest('tr') as HTMLElement
  expect(within(georgia).getByText('Test')).toBeTruthy()
  expect(within(georgia).getByText('BI / Extraction')).toBeTruthy()

  await user.selectOptions(screen.getByLabelText('Source'), 'BI')
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Contact Lists' })).queryByText('Fall Master Audience')).toBeNull())
  expect(calls.some((call) => call.url.includes('source=BI'))).toBe(true)
  await user.selectOptions(screen.getByLabelText('Source'), '')
  await user.selectOptions(screen.getByLabelText('Type'), 'TEST')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('list_environment=TEST'))).toBe(true))
  await user.selectOptions(screen.getByLabelText('Type'), '')
  await user.type(screen.getByLabelText('Search lists'), 'georgia')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('search=georgia'))).toBe(true))
})

test('create from a file: name and type, the file, the columns, the review, then the list exists; an upload is never said to be attached', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))

  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  expect(within(dialog).getByText(/^Step 1 of 5/)).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).getByRole('radio', { name: /Upload a file/ }).getAttribute('aria-checked')).toBe('true')
  await user.type(within(dialog).getByLabelText(/^List name/), 'Trade show leads')
  await user.click(within(dialog).getByRole('radio', { name: /^Test/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Add your file' })
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/contact-lists/'))?.body).toEqual({ name: 'Trade show leads', description: '', list_environment: 'TEST' })
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  await user.upload(within(dialog).getByLabelText('CSV file'), csv())
  expect(await within(dialog).findByText('leads.csv')).toBeTruthy()
  expect(within(dialog).getByText(/6 rows · 3 columns · 2 KB/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Match your columns' })
  expect((within(dialog).getByLabelText('CEP property for Email Address') as HTMLSelectElement).value).toBe('email')
  expect((within(dialog).getByLabelText('CEP property for Notes') as HTMLSelectElement).value).toBe('')
  expect(within(dialog).getByText('2 of 3 columns mapped')).toBeTruthy()
  // taking the email property away blocks the step and says why; a property moves with the column that takes it
  await user.selectOptions(within(dialog).getByLabelText('CEP property for Email Address'), '')
  expect(within(dialog).getByText(/email still needs a column/)).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  await user.selectOptions(within(dialog).getByLabelText('CEP property for Notes'), 'email')
  await user.selectOptions(within(dialog).getByLabelText('CEP property for Email Address'), 'email')
  expect((within(dialog).getByLabelText('CEP property for Notes') as HTMLSelectElement).value).toBe('')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Review before importing' })
  expect(calls.find((call) => call.url.endsWith('/review/'))?.body).toEqual({ mapping: { first_name: 'First Name', email: 'Email Address' } })
  expect(within(dialog).getByText('4 contacts')).toBeTruthy()
  expect(within(dialog).getByText('2 rows held back')).toBeTruthy()
  expect(within(dialog).getByText('New').previousElementSibling?.textContent).toBe('3')
  expect(within(dialog).getByText('Same email address as line 3', { exact: false })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Import contacts' }))

  dialog = await screen.findByRole('dialog', { name: 'List created' })
  expect(within(dialog).getByText('Trade show leads is ready')).toBeTruthy()
  expect(within(dialog).getByText(/4 contacts imported · 2 rows skipped/)).toBeTruthy()
  expect(within(dialog).getByText(/pick it manually when you attach it to a campaign/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(await within(await screen.findByRole('table', { name: 'Contact Lists' })).findByText('Trade show leads')).toBeTruthy()
})

test('leaving the upload wizard deletes the draft; a name that is taken is refused on the first step', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List name/), 'georgia ONLY')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Another list already has this name.')

  await user.clear(within(dialog).getByLabelText(/^List name/))
  await user.type(within(dialog).getByLabelText(/^List name/), 'Abandoned')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Add your file' })
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/contact-lists/cl-new/'))).toBe(true)
})

test('create from an audience and by cloning: three steps each, no file involved', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')

  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List name/), 'Win-back base')
  await user.click(within(dialog).getByRole('radio', { name: /BI or extraction tool/ }))
  expect(within(dialog).getByText(/^Step 1 of 3/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Choose an audience' })
  expect((within(dialog).getByRole('button', { name: 'Create list' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(await within(dialog).findByRole('radio', { name: /No purchase in 90 days/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create list' }))
  dialog = await screen.findByRole('dialog', { name: 'List created' })
  expect(calls.find((call) => call.url.endsWith('/from-audience/'))?.body).toEqual({ name: 'Win-back base', description: '', list_environment: 'PRODUCTION', audience: 'aud-lapsed' })
  expect(within(dialog).getByText(/refreshes with its source audience/)).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/contact-lists/'))).toBe(false)       // no draft for a vetted source
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List name/), 'Master (variant B)')
  await user.click(within(dialog).getByRole('radio', { name: /Clone a list/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Choose a list to copy' })
  await user.click(await within(dialog).findByRole('radio', { name: /Fall Master Audience/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create list' }))
  dialog = await screen.findByRole('dialog', { name: 'List created' })
  expect(calls.find((call) => call.url.endsWith('/contact-lists/cl-master/clone/'))?.body).toEqual({ name: 'Master (variant B)', description: '', list_environment: 'PRODUCTION' })
  expect(within(dialog).getByText(/90 contacts copied/)).toBeTruthy()
  expect(within(dialog).getByText(/snapshot/)).toBeTruthy()
})

test('inspect and fix: who is in the list and how they got there; what is safe to edit; add, remove, rename, retype', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists/cl-master')

  expect(await screen.findByRole('heading', { name: 'Fall Master Audience' })).toBeTruthy()
  const note = await screen.findByRole('note')
  await vi.waitFor(() => expect(note.textContent).toContain('attached to 1 live campaign'))
  expect(note.textContent).toContain('already built from it stays as it is')
  const attached = await screen.findByRole('region', { name: 'Attached campaigns' })
  expect(within(attached).getByText('Fall Promo Email')).toBeTruthy()
  expect(within(attached).getByText('1 Campaign List already built')).toBeTruthy()

  const table = await screen.findByRole('table', { name: 'Contacts in Fall Master Audience' })
  const sana = (await within(table).findByText('s.ramachandran@tailspin.example')).closest('tr') as HTMLElement
  expect(within(sana).getByText('Manual')).toBeTruthy()
  expect(within(sana).getByText('Aug 24, 2026')).toBeTruthy()
  expect(screen.getByText('No contacts selected')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Remove from list' }) as HTMLButtonElement).disabled).toBe(true)

  await user.type(screen.getByLabelText('Search contacts'), 'okonkwo')
  await vi.waitFor(() => expect(within(table).queryByText('s.ramachandran@tailspin.example')).toBeNull())
  await user.clear(screen.getByLabelText('Search contacts'))

  await user.click(await screen.findByLabelText('Select s.ramachandran@tailspin.example'))
  expect(screen.getByText('1 selected')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Remove from list' }))
  const confirm = await screen.findByRole('dialog', { name: 'Remove from this list?' })
  expect(confirm.textContent).toContain('They stay in CEP')
  await user.click(within(confirm).getByRole('button', { name: 'Remove 1' }))
  expect((await screen.findByRole('status')).textContent).toContain('1 contact removed from this list')
  expect(calls.find((call) => call.url.endsWith('/members/remove/'))?.body).toEqual({ ids: [13] })

  await user.click(screen.getByRole('button', { name: 'Add contacts' }))
  const add = await screen.findByRole('dialog', { name: 'Add contacts' })
  await user.type(within(add).getByLabelText('Email addresses'), 'ana@example.com, Ana, Lopez{enter}not-an-email')
  await user.click(within(add).getByRole('button', { name: 'Add 2 contacts' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 added · 1 new to CEP · not valid and skipped: not-an-email'))
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/members/')).at(-1)?.body).toEqual({
    contacts: [{ email: 'ana@example.com', first_name: 'Ana', last_name: 'Lopez' }, { email: 'not-an-email', first_name: '', last_name: '' }],
  })

  await user.click(screen.getByRole('button', { name: 'Edit details' }))
  const edit = await screen.findByRole('dialog', { name: 'Edit details' })
  await user.clear(within(edit).getByLabelText(/^List name/))
  await user.type(within(edit).getByLabelText(/^List name/), 'Fall Master Audience 2026')
  await user.selectOptions(within(edit).getByLabelText('List type'), 'TEST')
  await user.click(within(edit).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/contact-lists/cl-master/'))?.body).toEqual({ name: 'Fall Master Audience 2026', description: 'Active loyalty members', list_environment: 'TEST' })
  expect(await screen.findByRole('heading', { name: 'Fall Master Audience 2026' })).toBeTruthy()
})

test('a list on a campaign cannot be deleted from the table: the reason is shown, archiving is offered in the same menu', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Actions for Fall Master Audience' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeTruthy()
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete this list?' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete list' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('attached to a campaign')
})

test('building a list inside campaign setup: a vetted list is attached at once, an uploaded one waits for the operator', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit')

  // 1. from an audience: attached automatically
  await user.click(await screen.findByRole('button', { name: 'Create a list' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List name/), 'Gold for this campaign')
  await user.click(within(dialog).getByRole('radio', { name: /BI or extraction tool/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Choose an audience' })
  await user.click(await within(dialog).findByRole('radio', { name: /Loyalty Gold/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create list' }))
  dialog = await screen.findByRole('dialog', { name: 'List created' })
  expect(within(dialog).getByText(/attached to this campaign already/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  const gold = (await screen.findByText('Gold for this campaign')).closest('label') as HTMLElement
  expect((within(gold).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText(/“Gold for this campaign” is attached: it comes from a vetted audience/)).toBeTruthy()

  // 2. from a file: not attached until the operator says so
  await user.click(screen.getByRole('button', { name: 'Create a list' }))
  dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List name/), 'Booth scans')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Add your file' })
  await user.upload(within(dialog).getByLabelText('CSV file'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Match your columns' })).getByRole('button', { name: 'Continue' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Review before importing' })).getByRole('button', { name: 'Import contacts' }))
  dialog = await screen.findByRole('dialog', { name: 'List created' })
  expect(within(dialog).getByText(/not attached to this campaign yet/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  const waiting = await screen.findByRole('group', { name: 'Uploaded list waiting to be attached' })
  const booth = (await screen.findAllByText('Booth scans')).map((node) => node.closest('label')).find(Boolean) as HTMLElement
  expect((within(booth).getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  await user.click(within(waiting).getByRole('button', { name: 'I have checked it: attach to this campaign' }))
  await vi.waitFor(() => expect((within(booth).getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
  expect(screen.queryByRole('group', { name: 'Uploaded list waiting to be attached' })).toBeNull()
})
