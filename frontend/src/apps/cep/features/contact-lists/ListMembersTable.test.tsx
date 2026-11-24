import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('the contacts of a list: a Mobile Number column, and the pager with rows per page, previous and next, always shown', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists/cl-master')

  const table = await screen.findByRole('table', { name: /^Contacts in/ })
  expect(within(table).getByRole('columnheader', { name: 'Mobile Number' })).toBeTruthy()
  const miriam = (await within(table).findByText('m.okonkwo@fabrikam.example')).closest('tr') as HTMLElement
  expect(within(miriam).getByText('(404) 555-0002')).toBeTruthy()                       // +14045550002, as people read it
  const dolores = within(table).getByText('d.alvarez@northwind.example').closest('tr') as HTMLElement
  expect(dolores.textContent).toContain('—')                                            // no number on file

  const pager = document.querySelector('[data-members-pager]') as HTMLElement
  expect(pager.textContent).toContain('Showing 1–3 of 3 contacts')
  expect(within(pager).getByText('Page 1 of 1')).toBeTruthy()
  expect((within(pager).getByRole('button', { name: 'Previous Page' }) as HTMLButtonElement).disabled).toBe(true)
  expect((within(pager).getByRole('button', { name: 'Next Page' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(pager).getByRole('button', { name: '50' }).getAttribute('aria-pressed')).toBe('true')

  await user.click(within(pager).getByRole('button', { name: '25' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/contact-lists/cl-master/members/') && call.url.includes('page_size=25'))).toBe(true))
  expect(within(pager).getByRole('button', { name: '25' }).getAttribute('aria-pressed')).toBe('true')
})
