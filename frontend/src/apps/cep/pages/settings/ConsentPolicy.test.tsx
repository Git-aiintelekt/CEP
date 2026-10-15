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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('Consent Policy: the four settings save one by one, the attestation wording previews with the workspace name and saves on its own', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/consent')
  const settings = await screen.findByRole('region', { name: 'Consent Policy Settings' })
  expect(screen.getByRole('heading', { name: 'Consent Policy' })).toBeTruthy()

  const without = within(settings).getByRole('combobox', { name: 'People Without Consent' }) as HTMLSelectElement
  expect(without.value).toBe('HOLD_BACK')
  await user.selectOptions(without, 'REFUSE')
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/workspace/consent-policy/'))?.body).toEqual({ without_consent: 'REFUSE' }))

  const texts = within(settings).getByRole('switch', { name: 'Texts Need a Consent Date' })
  expect(texts.getAttribute('aria-checked')).toBe('false')
  await user.click(texts)
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ texts_need_date: true }))
  expect(within(settings).getByRole('switch', { name: 'Texts Need a Consent Date' }).getAttribute('aria-checked')).toBe('true')

  await user.click(within(settings).getByRole('switch', { name: 'Approval Before First Send' }))
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ approval_before_send: true }))

  const lifetime = within(settings).getByRole('combobox', { name: 'Consent Lifetime' }) as HTMLSelectElement
  expect([...lifetime.options].map((option) => option.textContent)).toEqual(['6 months', '1 year', '2 years', '3 years'])
  await user.selectOptions(lifetime, '12')
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ lifetime_months: 12 }))

  const sentence = screen.getByLabelText(/^Sentence/) as HTMLTextAreaElement
  expect(sentence.value).toBe('I confirm these people agreed to receive marketing from {workspace}')
  expect(screen.getByText('I confirm these people agreed to receive marketing from Northwind Apparel')).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Save Wording' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)                                                                  // nothing changed yet
  await user.clear(sentence)
  await user.type(sentence, 'I confirm {{workspace} may message these people')
  expect(screen.getByText('I confirm Northwind Apparel may message these people')).toBeTruthy()
  await user.click(save)
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ attestation: 'I confirm {workspace} may message these people' }))
})
