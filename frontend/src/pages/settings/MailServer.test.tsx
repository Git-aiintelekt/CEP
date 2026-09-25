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
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a workspace enters its own SMTP server: the password is sent once and never shown again; a test message can then be sent', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/email')

  expect(await screen.findByText(/No mail server is available/)).toBeTruthy()
  expect(screen.queryByLabelText(/Use the platform/)).toBeNull()
  await user.type(screen.getByLabelText(/^Server/), 'smtp.office365.com')
  await user.type(screen.getByLabelText(/^Username/), 'mailer@nwa.example')
  await user.type(screen.getByLabelText(/^Password/), 'app-password-1')
  await user.type(screen.getByLabelText(/^From Address/), 'hello@nwa.example')
  await user.type(screen.getByLabelText(/From Name/), 'Northwind')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Saved')).toBeTruthy()
  const put = calls.filter((call) => call.method === 'PUT').at(-1)
  expect(put?.body).toMatchObject({ host: 'smtp.office365.com', port: 587, security: 'STARTTLS', username: 'mailer@nwa.example', password: 'app-password-1', from_email: 'hello@nwa.example', from_name: 'Northwind', use_platform_server: false, campaign_sender: false })
  expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('')
  expect(screen.getByText('A password is stored. Leave this empty to keep it.')).toBeTruthy()
  expect(screen.getByText(/through your own server/)).toBeTruthy()

  const testSection = screen.getByRole('heading', { name: 'Send a Test Message' }).closest('section') as HTMLElement
  expect((within(testSection).getByLabelText(/^To/) as HTMLInputElement).value).toBe('aby.john@aiintelekt.com')
  await user.click(within(testSection).getByRole('button', { name: 'Send Test' }))
  expect(await within(testSection).findByText('Last Test Passed')).toBeTruthy()
  expect(calls.filter((call) => call.url.endsWith('/mail-server/test/')).at(-1)?.body).toEqual({ to: 'aby.john@aiintelekt.com' })
})

test('a failed test shows the reason; a field error lands on its field', async () => {
  installMockApi({ mailServer: { in_use: 'tenant', server: { host: 'smtp.broken.example', port: 465, security: 'SSL', username: null, has_password: true, from_email: 'hello@nwa.example', from_name: null,
                                                            reply_to: null, use_platform_server: false, campaign_sender: false, is_active: true, last_tested_at: null, last_test_ok: null, last_test_error: null } } })
  const user = userEvent.setup()
  await renderAppAt('/settings/email')

  const testSection = (await screen.findByRole('heading', { name: 'Send a Test Message' })).closest('section') as HTMLElement
  await user.click(within(testSection).getByRole('button', { name: 'Send Test' }))
  expect((await within(testSection).findByRole('alert')).textContent).toContain('ConnectionRefusedError')

  await user.clear(screen.getByLabelText(/^From Address/))
  await user.type(screen.getByLabelText(/^From Address/), 'bad')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
})

test('when the platform shares its server, the workspace can use it with its own From address and the SMTP fields disappear', async () => {
  const calls = installMockApi({ mailServer: { platform_shared: true, platform_host: 'smtp.cep.example', in_use: 'platform' } })
  const user = userEvent.setup()
  await renderAppAt('/settings/email')

  await user.click(await screen.findByLabelText(/Use the Platform's Mail Server/))
  expect(screen.getByText(/Sends through smtp.cep.example/)).toBeTruthy()                                // the host, in the hint
  expect(screen.queryByLabelText(/^Server/)).toBeNull()
  expect(screen.queryByLabelText(/^Password/)).toBeNull()
  await user.type(screen.getByLabelText(/^From Address/), 'hello@nwa.example')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Saved')).toBeTruthy()
  const put = calls.filter((call) => call.method === 'PUT').at(-1)
  expect(put?.body).toEqual({ use_platform_server: true, is_active: true, campaign_sender: false, from_email: 'hello@nwa.example', from_name: null, reply_to: null })
  expect(screen.getByText(/with your From address\./)).toBeTruthy()
})

test('offered as a campaign sender: pending until a test passes, then verified; the campaign form labels it', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/email')

  await user.type(await screen.findByLabelText(/^Server/), 'smtp.office365.com')
  await user.type(screen.getByLabelText(/^From Address/), 'hello@nwa.example')
  await user.type(screen.getByLabelText(/From Name/), 'Northwind')
  await user.click(screen.getByLabelText(/Offer as a Campaign Sender/))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Sender Not Verified Yet')).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toMatchObject({ campaign_sender: true })
  const testSection = screen.getByRole('heading', { name: 'Send a Test Message' }).closest('section') as HTMLElement
  await user.click(within(testSection).getByRole('button', { name: 'Send Test' }))
  expect(await screen.findByText('Verified Sender')).toBeTruthy()
  expect(screen.getByText(/Northwind · hello@nwa.example/)).toBeTruthy()
})
