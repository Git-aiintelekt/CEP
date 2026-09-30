import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn, stagedImport } from '@/test/mockApi'

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

/** the button of a step whose numbers come from the background worker: there, and enabled, once the worker is done */
async function ready(dialog: HTMLElement, name: string) {
  const button = (await within(dialog).findByRole('button', { name })) as HTMLButtonElement
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  return button
}

const csv = () => new File(['Email Address,First Name,Notes\na@x.example,Ana,vip\n'], 'leads.csv', { type: 'text/csv' })

test('browse: totals, every list with its type, source and use; search and the Type / Source filters go to the API', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')

  const totals = await screen.findByLabelText('Contact List Totals')
  await vi.waitFor(() => expect(within(totals).getByText('Total Lists').nextElementSibling?.textContent).toBe('2'))
  expect(within(totals).getByText('Attached to Live Campaigns').nextElementSibling?.textContent).toBe('1')

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
  expect(within(dialog).getByRole('radio', { name: /Upload a File/ }).getAttribute('aria-checked')).toBe('true')
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Trade show leads')
  await user.click(within(dialog).getByRole('radio', { name: /^Test/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Add Your File' })
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/contact-lists/'))?.body).toEqual({ name: 'Trade show leads', description: '', list_environment: 'TEST' })
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  expect(await within(dialog).findByText('leads.csv')).toBeTruthy()
  expect(await within(dialog).findByText(/6 rows · 3 columns · 2 KB/)).toBeTruthy()          // the row count arrives once the worker has read the file
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Match Your Columns' })
  expect((within(dialog).getByLabelText('CEP Property for Email Address') as HTMLSelectElement).value).toBe('email')
  expect((within(dialog).getByLabelText('CEP Property for Notes') as HTMLSelectElement).value).toBe('')
  expect(within(dialog).getByText('2 of 3 columns mapped')).toBeTruthy()
  // taking the email property away blocks the step and says why; a property moves with the column that takes it
  await user.selectOptions(within(dialog).getByLabelText('CEP Property for Email Address'), '')
  expect(within(dialog).getByText(/email still needs a column/)).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  await user.selectOptions(within(dialog).getByLabelText('CEP Property for Notes'), 'email')
  await user.selectOptions(within(dialog).getByLabelText('CEP Property for Email Address'), 'email')
  expect((within(dialog).getByLabelText('CEP Property for Notes') as HTMLSelectElement).value).toBe('')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  dialog = await screen.findByRole('dialog', { name: 'Review Before Importing' })
  expect(calls.find((call) => call.url.endsWith('/review/'))?.body).toEqual({ mapping: { first_name: 'First Name', email: 'Email Address' } })
  expect(await within(dialog).findByText('4 contacts')).toBeTruthy()                           // checked in the background, then shown
  expect(within(dialog).getByText('2 rows held back')).toBeTruthy()
  expect(within(dialog).getByText('New').previousElementSibling?.textContent).toBe('3')
  expect(within(dialog).getByText('Same email address as line 3', { exact: false })).toBeTruthy()

  // the governance check, contact by contact, before anything is imported; and numbers that add up
  const report = within(dialog).getByRole('region', { name: 'Upload Report' })
  const value = (label: string) => within(report).getByText(label).nextElementSibling?.textContent
  expect([value('Rows in the File'), value('Held Back'), value('Ready to Import'), value('New to CEP'), value('Already Known')]).toEqual(['6', '2', '4', '3', '1'])
  expect([value('Not a valid email address'), value('Same address earlier in the file')]).toEqual(['1', '1'])
  expect(within(report).queryByText('No email address')).toBeNull()                          // a reason with nothing in it is not listed
  expect([value('Can receive marketing email'), value('Unsubscribed'), value('Bounced: the address does not exist')]).toEqual(['2', '1', '1'])
  expect(within(report).queryByText('Suppressed')).toBeNull()
  expect(within(report).getByRole('img', { name: '2 of 4 can receive marketing email today' })).toBeTruthy()
  expect(report.textContent).toContain('6 rows = 2 held back + 4 ready. Of those 4, 2 can receive marketing email today and 2 cannot.')
  expect(report.textContent).toContain('Everyone ready is imported whatever their status')
  await user.click(await ready(dialog, 'Import Contacts'))

  dialog = await screen.findByRole('dialog', { name: 'List Created' })
  expect(within(dialog).getByText('Trade show leads is ready')).toBeTruthy()
  expect(within(dialog).getByText(/3 contacts imported · 2 rows skipped/)).toBeTruthy()
  expect(within(dialog).getByText(/pick it manually when you attach it to a campaign/)).toBeTruthy()
  // after the import: what happened, still adding up, and the row-by-row report to reconcile with
  const after = within(dialog).getByRole('region', { name: 'Upload Report' })
  expect(within(after).getByText('Added to the List').nextElementSibling?.textContent).toBe('3')
  expect(within(after).getByText('Already in the List').nextElementSibling?.textContent).toBe('1')
  expect(after.textContent).toContain('6 rows = 2 held back + 4 imported.')
  expect(after.textContent).toContain('3 were added to the list and 1 were in it already')
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:report', revokeObjectURL: () => undefined }))
  await user.click(within(after).getByRole('button', { name: /Download the Row-by-Row Report/ }))
  await vi.waitFor(() => expect(clicked).toHaveBeenCalled())
  expect(calls.some((call) => call.url.endsWith('/contact-lists/cl-new/imports/imp-1/report/'))).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(await within(await screen.findByRole('table', { name: 'Contact Lists' })).findByText('Trade show leads')).toBeTruthy()
})

test('leaving the upload wizard deletes the draft; a name that is taken is refused on the first step', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List Name/), 'georgia ONLY')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('Another list already has this name.')

  await user.clear(within(dialog).getByLabelText(/^List Name/))
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Abandoned')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Add Your File' })
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
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Win-back base')
  await user.click(within(dialog).getByRole('radio', { name: /BI or Extraction Tool/ }))
  expect(within(dialog).getByText(/^Step 1 of 3/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Choose an Audience' })
  expect((within(dialog).getByRole('button', { name: 'Create List' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(await within(dialog).findByRole('radio', { name: /No purchase in 90 days/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create List' }))
  dialog = await screen.findByRole('dialog', { name: 'List Created' })
  expect(calls.find((call) => call.url.endsWith('/from-audience/'))?.body).toEqual({ name: 'Win-back base', description: '', list_environment: 'PRODUCTION', audience: 'aud-lapsed' })
  expect(within(dialog).getByText(/refreshes with its source audience/)).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/contact-lists/'))).toBe(false)       // no draft for a vetted source
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Master (variant B)')
  await user.click(within(dialog).getByRole('radio', { name: /Clone a List/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Choose a List to Copy' })
  await user.click(await within(dialog).findByRole('radio', { name: /Fall Master Audience/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create List' }))
  dialog = await screen.findByRole('dialog', { name: 'List Created' })
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
  const attached = await screen.findByRole('region', { name: 'Attached Campaigns' })
  expect(within(attached).getByText('Fall Promo Email')).toBeTruthy()
  expect(within(attached).getByText('1 Campaign List already built')).toBeTruthy()

  const table = await screen.findByRole('table', { name: 'Contacts in Fall Master Audience' })
  const sana = (await within(table).findByText('s.ramachandran@tailspin.example')).closest('tr') as HTMLElement
  expect(within(sana).getByText('Manual')).toBeTruthy()
  expect(within(sana).getByText('Aug 24, 2026')).toBeTruthy()
  expect(within(sana).getByText('Unsubscribed')).toBeTruthy()                                 // each contact carries its status as of today
  expect(within((within(table).getByText('d.alvarez@northwind.example')).closest('tr') as HTMLElement).getByText('Can Receive')).toBeTruthy()
  const check = await screen.findByRole('region', { name: 'Governance Check' })
  expect(check.textContent).toContain('2 of 3 can receive it')
  expect(within(check).getByText('Unsubscribed').closest('div')?.textContent).toContain('1')
  expect(screen.getByText('No contacts selected')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Remove from List' }) as HTMLButtonElement).disabled).toBe(true)

  await user.type(screen.getByLabelText('Search contacts'), 'okonkwo')
  await vi.waitFor(() => expect(within(table).queryByText('s.ramachandran@tailspin.example')).toBeNull())
  await user.clear(screen.getByLabelText('Search contacts'))

  await user.click(await screen.findByLabelText('Select s.ramachandran@tailspin.example'))
  expect(screen.getByText('1 selected')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Remove from List' }))
  const confirm = await screen.findByRole('dialog', { name: 'Remove from this list?' })
  expect(confirm.textContent).toContain('They stay in CEP')
  await user.click(within(confirm).getByRole('button', { name: 'Remove 1' }))
  expect((await screen.findByRole('status')).textContent).toContain('1 contact removed from this list')
  expect(calls.find((call) => call.url.endsWith('/members/remove/'))?.body).toEqual({ ids: [13] })

  await user.click(screen.getByRole('button', { name: 'Add Contacts' }))
  const add = await screen.findByRole('dialog', { name: 'Add Contacts' })
  await user.type(within(add).getByLabelText('Email Addresses'), 'ana@example.com, Ana, Lopez{enter}not-an-email')
  await user.click(within(add).getByRole('button', { name: 'Add 2 Contacts' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 added · 1 new to CEP · not valid and skipped: not-an-email'))
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/members/')).at(-1)?.body).toEqual({
    contacts: [{ email: 'ana@example.com', first_name: 'Ana', last_name: 'Lopez' }, { email: 'not-an-email', first_name: '', last_name: '' }],
  })

  await user.click(screen.getByRole('button', { name: 'Edit Details' }))
  const edit = await screen.findByRole('dialog', { name: 'Edit Details' })
  await user.clear(within(edit).getByLabelText(/^List Name/))
  await user.type(within(edit).getByLabelText(/^List Name/), 'Fall Master Audience 2026')
  await user.selectOptions(within(edit).getByLabelText('List Type'), 'TEST')
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
  await user.click(within(dialog).getByRole('button', { name: 'Delete List' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('attached to a campaign')
})

test('building a list inside campaign setup: a vetted list is attached at once, an uploaded one waits as Needs review', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=audience')
  const openPicker = async () => {
    await user.click((await screen.findAllByRole('button', { name: 'Add Contact List' }))[0])
    return screen.findByRole('dialog', { name: 'Add Contact List' })
  }

  // 1. from an audience: attached automatically
  let dialog = await openPicker()
  await user.click(within(dialog).getByRole('radio', { name: 'From an Audience or a Clone' }))
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Gold for this campaign')
  expect(within(dialog).getByRole('radio', { name: /BI or Extraction Tool/ }).getAttribute('aria-checked')).toBe('true')   // opened on the way that was asked for
  expect(within(dialog).queryByRole('radio', { name: /Upload a File/ })).toBeNull()                    // the upload has its own tab
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await within(dialog).findByRole('heading', { name: 'Choose an Audience' })
  await user.click(await within(dialog).findByRole('radio', { name: /Loyalty Gold/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create List' }))
  await within(dialog).findByRole('heading', { name: 'List Created' })
  expect(within(dialog).getByText(/attached to this campaign already/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  const sendTo = () => screen.getByRole('table', { name: 'Lists this campaign is sent to' })
  const gold = (await within(await screen.findByRole('table', { name: 'Lists this campaign is sent to' })).findByRole('link', { name: 'Gold for this campaign (opens in a new tab)' })).closest('tr')!
  expect(within(gold).getByText(/^Auto-attached /)).toBeTruthy()
  expect(screen.getByText(/“Gold for this campaign” is attached: it comes from a vetted audience/)).toBeTruthy()

  // 2. from a file: not counted until the operator confirms it
  dialog = await openPicker()
  await user.click(within(dialog).getByRole('radio', { name: 'Upload New' }))
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Booth scans')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await within(dialog).findByRole('heading', { name: 'Add Your File' })
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await within(dialog).findByRole('heading', { name: 'Match Your Columns' })
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await within(dialog).findByRole('heading', { name: 'Review Before Importing' })
  await user.click(await ready(dialog, 'Import Contacts'))
  await within(dialog).findByRole('heading', { name: 'List Created' })
  expect(within(dialog).getByText(/waits in Send To as Needs review/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))

  const booth = (await within(sendTo()).findByRole('link', { name: 'Booth scans (opens in a new tab)' })).closest('tr')!
  expect(within(booth).getByText(/Needs Review · Uploaded file · not counted until you confirm/)).toBeTruthy()
  expect(booth.className).toContain('bg-warning-bg')
  expect(screen.getByText('File data isn’t checked upstream, so an uploaded list is only counted once you confirm it.')).toBeTruthy()
  await user.click(within(booth).getByRole('button', { name: 'Confirm' }))
  const confirmed = (await within(sendTo()).findByRole('link', { name: 'Booth scans (opens in a new tab)' })).closest('tr')!
  expect(within(confirmed).queryByRole('button', { name: 'Confirm' })).toBeNull()
  expect(within(confirmed).getByRole('button', { name: 'Remove Booth scans' })).toBeTruthy()
  expect(screen.queryByText(/File data isn’t checked upstream/)).toBeNull()
})

test('a large upload runs in the background: progress in the wizard, leave it running, an alert when it is done, and the uploads page', async () => {
  const calls = installMockApi({ listImportMs: 1500 })
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Big file')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Add Your File' })
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))             // the columns are known from the first lines: no waiting for the whole file
  await user.click(within(await screen.findByRole('dialog', { name: 'Match Your Columns' })).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Review Before Importing' })
  await user.click(await ready(dialog, 'Import Contacts'))

  dialog = await screen.findByRole('dialog', { name: 'Importing Your Contacts' })
  expect(calls.filter((call) => call.url.endsWith('/apply/')).length).toBe(1)
  expect(within(dialog).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')
  expect(screen.getByRole('button', { name: 'List Uploads: 1 in progress', hidden: true })).toBeTruthy()      // the header counts it (behind the dialog)
  expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()             // adding contacts is not interrupted half-way
  await user.click(within(dialog).getByRole('button', { name: 'Continue in the Background' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Importing Your Contacts' })).toBeNull())
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false)                     // leaving it running is not cancelling it

  // the header keeps watching; when the worker is done the operator is told, wherever they are
  const alert = await screen.findByText('“Big file” is ready', {}, { timeout: 4000 })
  const toast = alert.closest('[role=status]') as HTMLElement
  expect(screen.queryByText(/has been checked/)).toBeNull()                           // no alert for the step they were watching in the wizard
  expect(toast.textContent).toContain('3 contacts imported · 2 rows skipped')
  expect(within(toast).getByRole('link', { name: /Open the List/ }).getAttribute('href')).toBe('/contact-lists/cl-new')
  expect(await within(await screen.findByRole('table', { name: 'Contact Lists' })).findByText('Big file')).toBeTruthy()      // the table was refreshed

  await user.click(screen.getByRole('link', { name: 'Uploads' }))
  const uploads = await screen.findByRole('table', { name: 'List Uploads' })
  const row = (await within(uploads).findByText('Big file')).closest('tr') as HTMLElement
  expect(within(row).getByText('Imported')).toBeTruthy()
  expect(within(row).getByText('Aby John', { exact: false })).toBeTruthy()
  expect(within(row).getByRole('link', { name: 'Open the List' })).toBeTruthy()
  await user.click(within(row).getByRole('button', { name: 'Report' }))
  const reportDialog = await screen.findByRole('dialog', { name: 'Upload Report' })
  expect(reportDialog.textContent).toContain('6 rows = 2 held back + 4 imported.')
  expect(within(reportDialog).getByText('Unsubscribed').nextElementSibling?.textContent).toBe('1')
  expect(within(reportDialog).getByRole('button', { name: /Download the Row-by-Row Report/ })).toBeTruthy()
})

test('uploads page: what is running shows its progress, what waits can be continued, and an unfinished upload can be cancelled', async () => {
  const running = { ...stagedImport, id: 'imp-run', contact_list: 'cl-ga', list_name: 'Georgia only', file_name: 'big.csv', status: 'APPLYING' as const, phase: 'Adding contacts to the list',
                    working: true, row_count: 180000, progress: { done: 90000, total: 180000, percent: 50, unit: 'rows' as const } }
  const waiting = { ...stagedImport, id: 'imp-wait', contact_list: 'cl-master', list_name: 'Fall Master Audience', file_name: 'pos-export.csv', status: 'STAGED' as const,
                    phase: 'Read. Match the columns to continue', working: false, row_count: 6 }
  const calls = installMockApi({ listUploads: [running, waiting] })
  const user = userEvent.setup()
  await renderAppAt('/contact-lists/uploads')

  const table = await screen.findByRole('table', { name: 'List Uploads' })
  const busy = (await within(table).findByText('big.csv', { exact: false })).closest('tr') as HTMLElement
  expect(within(busy).getByText('In Progress')).toBeTruthy()
  expect(within(busy).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
  expect(within(busy).queryByRole('button', { name: 'Cancel' })).toBeNull()               // contacts are being added: not interruptible
  expect(screen.getByRole('button', { name: 'List Uploads: 1 in progress' })).toBeTruthy() // the header button counts it, on every page

  const idle = within(table).getByText('pos-export.csv', { exact: false }).closest('tr') as HTMLElement
  expect(within(idle).getByText('Waiting for You')).toBeTruthy()
  await user.click(within(idle).getByRole('button', { name: 'Continue' }))
  const dialog = await screen.findByRole('dialog', { name: 'Match Your Columns' })        // resumed where it stopped, with its columns
  expect((within(dialog).getByLabelText('CEP Property for Email Address') as HTMLSelectElement).value).toBe('email')
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await user.click(within(idle).getByRole('button', { name: 'Cancel' }))
  expect((await screen.findByRole('status')).textContent).toContain('The upload of “pos-export.csv” was cancelled.')
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/contact-lists/cl-master/imports/imp-wait/cancel/'))).toBe(true)
})

test('a file the worker cannot take: the reason is shown in the wizard instead of a spinner that never ends', async () => {
  installMockApi({ listUploadFails: true })
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Too big')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  dialog = await screen.findByRole('dialog', { name: 'Add Your File' })
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('Failed')
  expect((await within(dialog).findByRole('alert')).textContent).toContain('more than 250,000 rows')
  expect(within(dialog).getByRole('alert').textContent).toContain('Choose Replace to upload another file')
  expect((within(dialog).getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).getByRole('button', { name: 'Replace' })).toBeTruthy()
})

test('?new=1 (Home’s Create New) opens the wizard at once; closing it drops the parameter; without list.edit nothing opens', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists?new=1')
  const dialog = await screen.findByRole('dialog', { name: 'New Contact List' })
  await user.click(within(dialog).getAllByRole('button', { name: /^(Cancel|Close)$/ })[0])
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Contact List' })).toBeNull())
  expect(window.location.search).toBe('')
  cleanup()

  installMockApi({ me: { principal: { kind: 'user', id: 'u1', email: 'a@x.example', display_name: 'Read Only', is_platform_admin: false, permissions: ['list.view'] } } })
  await renderAppAt('/contact-lists?new=1')
  expect(await screen.findByRole('table', { name: 'Contact Lists' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'New Contact List' })).toBeNull()
})
