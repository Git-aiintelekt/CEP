import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, MFA_CODE, problem, signIn } from '@/test/mockApi'

async function renderAppAt(path: string, authenticated = true) {
  if (authenticated) signIn(path)
  else window.history.pushState({}, '', path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
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

async function fillLogin(user: ReturnType<typeof userEvent.setup>, password: string) {
  const workspace = await screen.findByLabelText('Workspace')
  await user.clear(workspace)
  await user.type(workspace, 'NWA')
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Log In' }))
}

test('sign-in with a second factor: the password alone stores no token; a wrong code is refused; the right one signs in', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/login', false)

  await fillLogin(user, 'needs-a-code')
  const code = await screen.findByLabelText('Authentication Code')
  expect(window.localStorage.getItem('cep.access')).toBeNull()

  await user.type(code, '000000')
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect((await screen.findByRole('alert')).textContent).toContain('That code is not right')

  await user.clear(code)
  await user.type(code, MFA_CODE)
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy()
  expect(window.localStorage.getItem('cep.access')).toBe('access-1')
  const verify = calls.filter((call) => call.url.endsWith('/auth/mfa/verify/')).at(-1)
  expect(verify?.body).toEqual({ mfa_token: 'mfa-token-1', code: MFA_CODE })
  expect(verify?.headers.Authorization).toBeUndefined()
})

test('a workspace with single sign-on shows its button; when it is required the password form is tucked away for administrators', async () => {
  installMockApi({ authOptions: { sso_enabled: true, sso_enforced: true, sso_name: 'Okta' } })
  const user = userEvent.setup()
  await renderAppAt('/login', false)

  const workspace = await screen.findByLabelText('Workspace')
  await user.clear(workspace)
  await user.type(workspace, 'NWA')
  const button = await screen.findByRole('link', { name: 'Log In with Okta' })
  expect(button.getAttribute('href')).toContain('/auth/sso/start/?tenant=NWA&next=%2F')
  expect(screen.queryByLabelText('Password')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Administrator? Log in with a password' }))
  expect(screen.getByLabelText('Password')).toBeTruthy()
})

test('a failed single sign-on comes back to the login page with its reason, and the address bar is cleaned', async () => {
  installMockApi()
  await renderAppAt('/login#sso_error=Your+email+domain+is+not+allowed', false)
  expect((await screen.findByRole('alert')).textContent).toBe('Your email domain is not allowed')
  expect(window.location.hash).toBe('')
})

test('the single sign-on landing page takes the code out of the address bar and continues to the page asked for', async () => {
  installMockApi()
  window.sessionStorage.setItem('cep.sso.binding', 'tab-binding-1')
  await renderAppAt('/sso/complete#code=sso-code-1&tenant=NWA', false)
  expect(await screen.findByRole('heading', { name: 'Campaigns' })).toBeTruthy()
  expect(window.location.pathname).toBe('/campaigns')
  expect(window.location.hash).toBe('')
  expect(window.localStorage.getItem('cep.refresh')).toBe('refresh-1')
})

test('an outside address in `next` is ignored', async () => {
  installMockApi()
  window.sessionStorage.setItem('cep.sso.binding', 'tab-binding-1')
  await renderAppAt('/sso/complete#code=sso-code-outside&tenant=NWA', false)
  expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy()
  expect(window.location.pathname).toBe('/')
})

test('a support session forgets any earlier refresh token, shows who is acting and why it is limited, hides Settings, and ends on request', async () => {
  const calls = installMockApi({ me: { support_session: { by: 'Pat Support', mode: 'READ', expires_at: '2026-09-18T12:30:00Z' } } })
  const user = userEvent.setup()
  window.localStorage.setItem('cep.refresh', 'someone-elses-refresh')
  await renderAppAt('/support-session#token=access-1&tenant=NWA', false)

  const banner = await screen.findByText(/Support session: Pat Support is acting as this user · read-only/)
  expect(window.localStorage.getItem('cep.refresh')).toBeNull()
  expect(within(screen.getByRole('navigation', { name: 'Apps' })).queryByText('Settings')).toBeNull()
  await user.click(within(banner.parentElement as HTMLElement).getByRole('button', { name: 'End session' }))
  expect(await screen.findByLabelText('Password')).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/auth/support-session/end/') && call.method === 'POST')).toBe(true)
  expect(window.localStorage.getItem('cep.access')).toBeNull()
})

test('features switched off for the workspace disappear from navigation, settings and channel choices', async () => {
  installMockApi({ me: { industry: 'FINANCIAL_SERVICES', features: { journeys: false, mms: false, ereceipt: false, api_access: false } } })
  await renderAppAt('/templates/new')

  const channel = (await screen.findByRole('combobox', { name: 'Channel' })) as HTMLSelectElement
  expect([...channel.options].map((option) => option.value)).toEqual(['EMAIL', 'SMS'])
  expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByText('Journeys')).toBeNull()

  cleanup()
  await renderAppAt('/settings')
  const tabs = await screen.findByRole('navigation', { name: 'Settings sections' })
  expect(within(tabs).queryByText('API Keys')).toBeNull()
  expect(within(tabs).getByText('Plan & Usage')).toBeTruthy()
})

test('someone who must enrol in MFA is taken to account security and nowhere else; enrolling shows the recovery codes once', async () => {
  const calls = installMockApi({ me: { mfa_setup_required: true } })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')

  expect(await screen.findByText(/Your workspace requires multi-factor authentication/)).toBeTruthy()
  expect(window.location.pathname).toBe('/account/security')
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  expect(screen.getByRole('navigation', { name: 'Apps' }).querySelectorAll('a').length).toBe(0)

  await user.click(await screen.findByRole('button', { name: 'Set Up' }))
  expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('img', { name: /QR code/ }).querySelector('svg')).toBeTruthy(), { timeout: 5000 })
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()

  await user.type(screen.getByLabelText(/^Code/), '111111')
  await user.click(screen.getByRole('button', { name: 'Turn On' }))
  expect(await screen.findByText(/Check the time on your phone/)).toBeTruthy()

  await user.clear(screen.getByLabelText(/^Code/))
  await user.type(screen.getByLabelText(/^Code/), MFA_CODE)
  await user.click(screen.getByRole('button', { name: 'Turn On' }))
  const codes = await screen.findByRole('list', { name: 'Recovery codes' })
  expect(within(codes).getAllByRole('listitem').length).toBe(3)
  expect(calls.filter((call) => call.url.endsWith('/auth/mfa/') && call.method === 'POST').map((call) => call.body?.action)).toEqual(['setup', 'confirm', 'confirm'])
})

test('plan and usage: meters with their state, the channel breakdown and issued invoices', async () => {
  installMockApi()
  await renderAppAt('/settings/plan')

  expect(await screen.findByRole('heading', { name: 'Growth Plan' })).toBeTruthy()
  const meters = within(screen.getByRole('list', { name: 'Usage' })).getAllByRole('listitem')
  expect(meters.length).toBe(5)
  expect(within(meters[0]).getByText('Close to the limit')).toBeTruthy()
  expect(within(meters[0]).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('85')
  expect(within(meters[3]).getByText('No limit on this plan')).toBeTruthy()
  expect(within(meters[3]).queryByRole('progressbar')).toBeNull()
  expect(within(meters[4]).getByText('50 a month on the Growth plan + 70 added for September. Added tests end on Sep 30.')).toBeTruthy()
  const row = within(await screen.findByRole('table', { name: 'Invoices' })).getByText('INV-NWA-202608').closest('tr') as HTMLElement
  expect(row.textContent).toContain('$501.70')
  expect(row.textContent).toContain('$2.70 overage')
})

test('security: requiring MFA without having it yourself is refused with a way forward', async () => {
  installMockApi({ onSecurityWrite: () => problem(400, { title: 'Invalid input', errors: { require_mfa: ['Set up multi-factor authentication on your own account first, so you are not locked out.'] } }) })
  const user = userEvent.setup()
  await renderAppAt('/settings/security')

  await user.click(await screen.findByLabelText(/Require for Everyone/))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('on your own account first')
  expect(within(alert).getByRole('link', { name: 'Set It Up Now' }).getAttribute('href')).toBe('/account/security')
})

test('security: single sign-on is configured with a write-only secret, and the support access log is visible', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/security')

  await user.click(await screen.findByRole('button', { name: 'Set Up Single Sign-On' }))
  expect(screen.getByText('http://localhost:8000/api/v1/auth/sso/callback/')).toBeTruthy()
  await user.type(screen.getByLabelText(/Name on the Sign-In Button/), 'Okta')
  await user.type(screen.getByLabelText(/^Issuer/), 'https://login.example.com')
  await user.type(screen.getByLabelText(/^Client ID/), 'cep-client')
  await user.type(screen.getByLabelText(/^Client Secret/), 's3cret')
  await user.type(screen.getByRole('textbox', { name: 'Allowed Email Domains' }), 'example.com, partner.example')
  await user.click(screen.getByRole('button', { name: 'Save Single Sign-On' }))

  expect(await screen.findByText('Saved')).toBeTruthy()
  const put = calls.filter((call) => call.method === 'PUT').at(-1)
  expect(put?.body?.identity_provider).toMatchObject({ display_name: 'Okta', issuer: 'https://login.example.com', client_id: 'cep-client', client_secret: 's3cret',
                                                       allowed_email_domains: ['example.com', 'partner.example'], is_active: true, enforce_sso: false })
  expect((screen.getByLabelText(/^Client Secret/) as HTMLInputElement).value).toBe('')
  expect(screen.getByText('A secret is stored. Leave this empty to keep it.')).toBeTruthy()

  const log = await screen.findByRole('table', { name: 'Support Access' })
  expect(within(log).getByText('Ticket 4821: cannot find a campaign')).toBeTruthy()
  expect(within(log).getByText('Read-Only')).toBeTruthy()
})

test('a password link can be emailed by the platform instead of being copied by hand', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')

  const row = within(await screen.findByRole('table', { name: 'Users' })).getByText('devon@example.com').closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Password Link' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: 'Email the Link' }))
  expect((await within(dialog).findByRole('status')).textContent).toContain('Sent to devon@example.com')
  expect(calls.filter((call) => call.url.endsWith('/password-link/')).map((call) => call.body)).toEqual([{}, { send: true }])
  expect((within(dialog).getByLabelText('One-Time Link') as HTMLInputElement).value).toContain('token=mailed-456')
})
