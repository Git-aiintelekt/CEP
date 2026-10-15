/**
 * Where the Deliverability tab gets its tests: the API for a real template, an in-memory stand-in for the playground.
 * The panel polls `read` while a test is running; `start` counts against the plan's monthly allowance.
 */
import { api } from '@/lib/api'
import type { DeliverabilityAllowance, DeliverabilityPreview, DeliverabilityTest, DeliverabilityTestList } from '@/lib/types'

export interface DeliverabilityBackend {
  list: () => Promise<DeliverabilityTestList>
  start: () => Promise<DeliverabilityTest>
  read: (id: string) => Promise<DeliverabilityTest>
  remove: (id: string) => Promise<void>
}

export function apiDeliverability(templateId: string): DeliverabilityBackend {
  return {
    list: () => api.get<DeliverabilityTestList>(`/templates/${templateId}/deliverability-tests/`),
    start: () => api.post<DeliverabilityTest>(`/templates/${templateId}/deliverability-tests/`, {}),
    read: (id) => api.get<DeliverabilityTest>(`/deliverability-tests/${id}/`),
    remove: (id) => api.delete(`/deliverability-tests/${id}/`),
  }
}

const SAMPLE_CLIENTS: Omit<DeliverabilityPreview, 'status' | 'detail' | 'screenshot' | 'screenshot_no_images' | 'thumbnail' | 'full_thumbnail'>[] = [
  { id: 'gmail_chr_win', name: 'Gmail (Chrome)', client: 'Gmail', os: 'Windows', category: 'Web', browser: 'Chrome' },
  { id: 'outlook_web', name: 'Outlook.com (Edge)', client: 'Outlook.com', os: 'Windows', category: 'Web', browser: 'Edge' },
  { id: 'yahoo_chr', name: 'Yahoo! Mail (Chrome)', client: 'Yahoo! Mail', os: 'macOS', category: 'Web', browser: 'Chrome' },
  { id: 'outlook365', name: 'Outlook 365', client: 'Outlook 365', os: 'Windows', category: 'Application', browser: '' },
  { id: 'applemail', name: 'Apple Mail', client: 'Apple Mail', os: 'macOS 14', category: 'Application', browser: '' },
  { id: 'iphone15', name: 'iPhone 15', client: 'iPhone 15 (iOS 17)', os: 'iOS 17', category: 'Mobile', browser: '' },
  { id: 'gmail_android', name: 'Gmail (Pixel 8)', client: 'Gmail app', os: 'Android 14', category: 'Mobile', browser: '' },
  { id: 'outlook_ios', name: 'Outlook (iPhone)', client: 'Outlook app', os: 'iOS 17', category: 'Mobile', browser: '' },
]

/** a stand-in screenshot: the client's name on a pale card, as a data URI so nothing is fetched */
function placeholder(label: string, wide: boolean): string {
  const width = wide ? 600 : 320
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${wide ? 760 : 420}" viewBox="0 0 ${width} ${wide ? 760 : 420}"><rect width="100%" height="100%" fill="#f9fafb"/><rect x="${width * 0.1}" y="40" width="${width * 0.8}" height="${wide ? 640 : 330}" rx="8" fill="#ffffff" stroke="#e2e4eb"/><rect x="${width * 0.16}" y="80" width="${width * 0.68}" height="${wide ? 90 : 50}" rx="4" fill="#dee9fc"/><rect x="${width * 0.16}" y="${wide ? 200 : 150}" width="${width * 0.5}" height="14" rx="3" fill="#cfd2dc"/><rect x="${width * 0.16}" y="${wide ? 230 : 175}" width="${width * 0.62}" height="14" rx="3" fill="#e2e4eb"/><rect x="${width * 0.16}" y="${wide ? 260 : 200}" width="${width * 0.4}" height="14" rx="3" fill="#e2e4eb"/><text x="50%" y="${wide ? 720 : 400}" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#4b4f5b">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** The playground's backend: one test already finished, a new one that completes after a moment, and an allowance of 20. */
export function sampleDeliverability(): DeliverabilityBackend {
  const allowance = (): DeliverabilityAllowance => ({ enabled: true, used: tests.length, limit: 20, left: Math.max(0, 20 - tests.length), month: '2026-10-01', plan: 'Growth', configured: true,
                                                      plan_limit: 20, added: 0, account: 'PLATFORM', note: '20 a month on the Growth plan.' })
  const previews = (failOne: boolean): DeliverabilityPreview[] =>
    SAMPLE_CLIENTS.map((client, index) => ({
      ...client,
      status: failOne && index === 7 ? 'FAILED' : 'COMPLETE',
      detail: failOne && index === 7 ? 'The client did not load the message.' : '',
      screenshot: failOne && index === 7 ? '' : placeholder(client.name, true), screenshot_no_images: '',
      thumbnail: failOne && index === 7 ? '' : placeholder(client.name, false), full_thumbnail: '',
    }))
  const finished = (id: string, version: number, at: string, failOne: boolean): DeliverabilityTest => ({
    id, template: 'playground', template_version: version, kind: 'PREVIEW', provider: 'MAILGUN_INSPECT', status: 'COMPLETE', subject: 'Aaliyah, 20% off this weekend only',
    clients: SAMPLE_CLIENTS.map((c) => c.id), summary: { clients: 8, complete: failOne ? 7 : 8, failed: failOne ? 1 : 0, processing: 0 }, error: null,
    requested_by: 'Devon Okafor', requested_at: at, completed_at: at, previews: previews(failOne), spam: null, placement: null,
  })
  const tests: DeliverabilityTest[] = [finished('sample-1', 2, '2026-09-30T14:12:00Z', true)]
  const timers = new Set<number>()
  return {
    list: async () => ({ tests: tests.map((test) => ({ ...test, previews: [] })), allowance: allowance() }),
    start: async () => {
      const id = `sample-${tests.length + 1}`
      const running: DeliverabilityTest = { ...finished(id, 3, new Date().toISOString(), false), status: 'PENDING', completed_at: null,
                                            summary: { clients: 8, complete: 0, failed: 0, processing: 8 }, previews: previews(false).map((p) => ({ ...p, status: 'PROCESSING', screenshot: '', thumbnail: '' })) }
      tests.unshift(running)
      timers.add(window.setTimeout(() => { Object.assign(running, finished(id, 3, running.requested_at, false), { requested_at: running.requested_at }) }, 2500))
      return { ...running }
    },
    read: async (id) => {
      const found = tests.find((test) => test.id === id)
      if (!found) throw new Error('No such test.')
      return { ...found }
    },
    remove: async (id) => { const at = tests.findIndex((test) => test.id === id); if (at >= 0) tests.splice(at, 1) },
  }
}
