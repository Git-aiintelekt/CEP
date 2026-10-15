import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Test step gives the preview three quarters of the width, and a click on the message opens it large in a pop-up', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 4 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=test')
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Test'))

  const layout = document.querySelector('[data-test-step-layout]')!
  expect(layout.className).toContain('xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]')
  expect(within(layout as HTMLElement).getByRole('heading', { level: 2, name: 'Preview' })).toBeTruthy()
  expect(within(layout as HTMLElement).getByRole('heading', { level: 2, name: 'Send a Test' })).toBeTruthy()
  const inline = await screen.findByTitle('Email preview')
  expect(inline.className).toContain('h-[560px]')

  await user.click(screen.getByRole('button', { name: 'Open a Larger Preview' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByTitle('Email preview').hasAttribute('data-fitted-email')).toBe(true)      // the whole email, at its own height
  expect(within(dialog).getByRole('radiogroup', { name: 'Preview Size' })).toBeTruthy()
  await user.keyboard('{Escape}')
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await user.click(screen.getByRole('button', { name: 'Enlarge' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})
