/**
 * The Content step: the template row and its Choose a Template drawer, and the preview's tabs.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign } from '@/test/mockApi'
import { pickTemplate } from '@/test/pickTemplate'

async function renderAppAt(path: string) {
  const { signIn } = await import('@/test/mockApi')
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const row = async () => within(await screen.findByRole('group', { name: 'Template' }))

test('Change opens the drawer: nothing changes until Use Template; Cancel and Escape leave the template as it was', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, template: null }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  expect((await row()).getByText('No template chosen yet.')).toBeTruthy()
  await user.click((await row()).getByRole('button', { name: 'Choose a Template' }))
  let drawer = await screen.findByRole('dialog', { name: 'Choose a Template' })
  expect((within(drawer).getByRole('button', { name: 'Use Template' }) as HTMLButtonElement).disabled).toBe(true)     // nothing picked
  await user.type(within(drawer).getByLabelText('Search templates'), 'zzz')
  expect(within(drawer).getByText('No template matches that search.')).toBeTruthy()
  await user.clear(within(drawer).getByLabelText('Search templates'))
  const card = within(drawer).getByRole('radio', { name: /Fall Email/ })
  await user.click(card)
  expect(card.getAttribute('aria-checked')).toBe('true')
  expect(card.querySelector('[data-template-thumbnail]')).toBeTruthy()                                                  // the picked card shows a preview
  const scrollTo = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = scrollTo
  await user.click(within(drawer).getByRole('radio', { name: /Fall Email/ }))                                          // a click on a card never scrolls the list
  expect(scrollTo).not.toHaveBeenCalled()
  await user.click(within(drawer).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog', { name: 'Choose a Template' })).toBeNull()
  expect((await row()).getByText('No template chosen yet.')).toBeTruthy()

  await user.click((await row()).getByRole('button', { name: 'Choose a Template' }))
  drawer = await screen.findByRole('dialog', { name: 'Choose a Template' })
  await user.click(within(drawer).getByRole('radio', { name: /Fall Email/ }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Choose a Template' })).toBeNull()
  expect((await row()).getByText('No template chosen yet.')).toBeTruthy()

  await pickTemplate(user, /Fall Email/)
  expect((await row()).getByText('Fall Email')).toBeTruthy()
  expect((await row()).getByRole('button', { name: 'Change' })).toBeTruthy()
  await user.click((await row()).getByRole('button', { name: 'Change' }))
  drawer = await screen.findByRole('dialog', { name: 'Choose a Template' })
  expect(within(drawer).getByRole('radio', { name: /Fall Email/ }).getAttribute('aria-checked')).toBe('true')          // the current one is picked when it opens
})

test('an email campaign previews with a desktop / mobile switch and no tabs; a text campaign previews as a phone', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, template: 'tpl-email' }) })
  await renderAppAt('/campaigns/c1/edit?step=content')
  expect(await screen.findByRole('heading', { name: 'Preview' })).toBeTruthy()
  expect(screen.getByRole('radiogroup', { name: 'Preview Size' })).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Inbox Row' })).toBeNull()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, channel: 'SMS', template: 'tpl-sms' }) })
  await renderAppAt('/campaigns/c1/edit?step=content')
  await screen.findByRole('group', { name: 'Template' })
  expect(screen.queryByRole('radiogroup', { name: 'Preview Size' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy()
})
