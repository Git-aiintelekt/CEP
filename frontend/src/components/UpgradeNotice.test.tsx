import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { UpgradeNotice } from '@/components/UpgradeNotice'

let status: () => Response
let build: () => Response
const asked: string[] = []
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  window.sessionStorage.clear()
  asked.length = 0
  status = () => json({ upgrade: { state: 'NONE' } })
  build = () => json({ detail: 'Not found' }, 404)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    asked.push(url.split('?')[0])
    return url.includes('/platform-status/') ? status() : url.includes('version.json') ? build() : json({})
  })
})
afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  vi.unstubAllGlobals()
})

function show() {
  const root = document.body.appendChild(document.createElement('div'))
  root.id = 'root'
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><UpgradeNotice /><input aria-label="Subject" defaultValue="Up to 40% off" /></QueryClientProvider>, { container: root })
}

test('a scheduled upgrade shows a strip in the viewer’s time, with the length and the note, and can be hidden until closer to the time', async () => {
  const startsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  status = () => json({ upgrade: { state: 'SCHEDULED', starts_at: startsAt, minutes: 10, note: 'New Delivery Warm-Up reports.', changed_at: new Date().toISOString() } })
  show()

  const strip = await screen.findByText(/^Scheduled upgrade (today|tomorrow) at .+, about 10 minutes\.$/)
  expect(strip.closest('[role="status"]')?.textContent).toContain('Save your work before then. New Delivery Warm-Up reports.')
  await userEvent.click(screen.getByRole('button', { name: 'Hide Until Closer to the Time' }))
  expect(screen.queryByText(/Scheduled upgrade/)).toBeNull()
})

test('fifteen minutes before, the strip says how long is left and cannot be hidden', async () => {
  status = () => json({ upgrade: { state: 'SCHEDULED', starts_at: new Date(Date.now() + 12 * 60_000).toISOString(), minutes: 5, note: '' } })
  show()

  expect(await screen.findByText(/^Scheduled upgrade in 1[12] minutes \(.+\), about 5 minutes\.$/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Hide Until Closer to the Time' })).toBeNull()
})

test('while the install script says it is upgrading, the page dims under the card, keeps what was typed, and lifts once it is done', async () => {
  status = () => json({ upgrade: { state: 'UPGRADING', minutes: 10, changed_at: new Date().toISOString() } })
  show()

  const card = await screen.findByRole('alertdialog', { name: 'Upgrade in Progress' }, { timeout: 6000 })
  expect(card.textContent).toContain('Your unsaved changes stay on this page.')
  expect(card.textContent).toMatch(/Checking again in \d+ s · since/)
  expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true)
  expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Up to 40% off')

  status = () => json({ upgrade: { state: 'DONE', version: 'v9.9.9', changed_at: new Date().toISOString() } })
  await userEvent.click(screen.getByRole('button', { name: 'Check Now' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false)
  await waitFor(() => expect(asked).toContain('/version.json'))       // the build is compared once the card lifts
})

test('when the API stops answering with no upgrade known, the card says Reconnecting, and a one-off failure never shows it', async () => {
  show()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

  status = () => new Response('<html>Bad Gateway</html>', { status: 502 })
  window.dispatchEvent(new Event('cep:unreachable'))
  expect(await screen.findByRole('alertdialog', { name: 'Reconnecting' }, { timeout: 6000 })).toBeTruthy()

  status = () => json({ upgrade: { state: 'NONE' } })
  await userEvent.click(screen.getByRole('button', { name: 'Check Now' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

  window.dispatchEvent(new Event('cep:unreachable'))                       // the API answers the check at once: nothing dims
  await new Promise((resolve) => setTimeout(resolve, 3500))
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('after the upgrade a newer build is offered with Reload; Later hides it', async () => {
  build = () => json({ version: 'v9.9.9' })
  status = () => json({ upgrade: { state: 'DONE', version: 'v9.9.9', changed_at: new Date().toISOString() } })
  show()

  expect(await screen.findByText('C360 has been upgraded to v9.9.9. Save your changes, then reload.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(screen.queryByText(/has been upgraded/)).toBeNull()
})
