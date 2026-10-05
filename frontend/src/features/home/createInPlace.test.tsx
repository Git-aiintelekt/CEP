import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('every Create button on Home opens its pop-up on Home, never another page', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/')
  const create = await screen.findByRole('region', { name: 'Create New' })
  const dialogs: [string, RegExp][] = [['Create Campaign', /Create Campaign/], ['Contact List', /New Contact List/], ['Template', /Create a Template/]]
  for (const [button, title] of dialogs) {
    await user.click(within(create).getByRole('button', { name: button }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText(title).length).toBeGreaterThan(0)
    expect(window.location.pathname).toBe('/')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  }
})

test('the Template pop-up: step 1 the name, channel and description; step 2 blank or a starter; Back keeps what was typed', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/')
  await user.click(within(await screen.findByRole('region', { name: 'Create New' })).getByRole('button', { name: 'Template' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/^Step 1 of 2/)).toBeTruthy()
  expect(within(dialog).getByRole('combobox', { name: /Channel/ })).toBeTruthy()
  expect(within(dialog).getByRole('textbox', { name: /Description/ })).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

  await user.type(within(dialog).getByRole('textbox', { name: /Template Name/ }), 'Fall Sale Announcement')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  expect(await within(screen.getByRole('dialog')).findByText(/^Step 2 of 2/)).toBeTruthy()
  expect(await within(screen.getByRole('dialog')).findByRole('radio', { name: /Blank/ })).toBeTruthy()

  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }))
  expect((within(screen.getByRole('dialog')).getByRole('textbox', { name: /Template Name/ }) as HTMLInputElement).value).toBe('Fall Sale Announcement')
})
