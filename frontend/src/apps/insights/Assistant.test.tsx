/** AI · Ask for a Report: the box above the report list, a draft and Open in Editor, a question back, when the box is absent, the data to ask
 * about, images and documents, a draft on tables not mapped yet, and Settings → AI Assistant. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsAssistantNow, me, reportDatabasesNow, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, meOverride: object = withInsights, before: () => void = () => undefined) {
  const calls = installMockApi({ me: meOverride as never })
  before()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the box sits above the list with the month’s use and the examples; Generate sends the prompt and the model; the draft reads in words and Open in Editor opens the new report', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect(within(box).getByText('38 of 200 prompts used in October')).toBeTruthy()
  await user.click(within(box).getByRole('button', { name: 'Delivered rate by sending engine, by week' }))
  const prompt = within(box).getByRole('textbox', { name: 'What do you want to see?' }) as HTMLTextAreaElement
  expect(prompt.value).toBe('Delivered rate by sending engine, by week')
  await user.clear(prompt)
  await user.type(prompt, 'Sent and delivered by campaign for September')
  // the model picker: Claude's reports model is the default, OpenAI's models are offered too
  await user.click(within(box).getByRole('button', { name: /Claude Sonnet 5.5/ }))
  const menu = await screen.findByRole('region', { name: 'Model' })
  expect(within(menu).getByRole('button', { name: /GPT-5 mini/ })).toBeTruthy()
  await user.click(within(menu).getByRole('button', { name: /GPT-5 mini/ }))
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  const asked = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.body as Record<string, unknown>
  expect(asked).toEqual({ prompt: 'Sent and delivered by campaign for September', model: 'openai:gpt-5-mini' })
  expect(within(card).getByText('Sent and Delivered by Campaign')).toBeTruthy()
  expect(within(card).getByText('Campaign')).toBeTruthy()                                   // Rows
  expect(within(card).getByText('Sum of Sent Count, Sum of Delivered Count')).toBeTruthy()   // Values
  expect(within(card).getByText('Sent between 2026-09-01 and 2026-09-30')).toBeTruthy()      // Filter
  expect(within(card).getByText('Preview: 12 rows')).toBeTruthy()
  expect(within(box).getByText('39 of 200 prompts used in October')).toBeTruthy()            // the draft counted
  await user.click(within(card).getByRole('button', { name: 'Open in Editor' }))
  await screen.findByRole('textbox', { name: 'Report name' })
  expect(calls.some((call) => call.url.endsWith('/insights/assistant/ask-1/open/') && call.method === 'POST')).toBe(true)
  expect(window.location.pathname).toBe('/insights/reports/rep-ai/edit')
})

test('a question back offers its answers as buttons, and an answer is sent as the next prompt without a count', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Which campaigns made the most revenue last month?')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'One Question First' })
  expect(within(card).getByText('Which period is last month?')).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'September 2026, the calendar month' }))
  await screen.findByRole('region', { name: 'Draft Report' })
  const answered = calls.filter((call) => call.url.endsWith('/insights/assistant/ask/')).at(-1)?.body as Record<string, unknown>
  expect(answered.prompt).toBe('Revenue by campaign for September 2026')
  expect(answered.answer_to).toBe('ask-q')
})

test('no field for it: the message and the closest prompts; a failure says so with Try Again', async () => {
  await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Website visits by campaign')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'No Field for This' })
  expect(within(card).getByText(/No dataset has website visits/)).toBeTruthy()
  expect(within(card).getByRole('button', { name: 'Clicks by Campaign' })).toBeTruthy()
  expect(within(card).queryByRole('button', { name: 'Open in Editor' })).toBeNull()
  await user.click(within(card).getByRole('button', { name: 'Clicks by Campaign' }))
  await screen.findByRole('region', { name: 'Draft Report' })
})

test('the box is absent without the right, when the platform has no provider, and when the workspace switched AI off', async () => {
  await renderAppAt('/insights/reports', { ...withInsights, principal: me.principal })
  await screen.findByRole('table', { name: 'Reports' })
  expect(screen.queryByRole('region', { name: 'Ask for a Report' })).toBeNull()
  cleanup()
  await renderAppAt('/insights/reports', withInsights, () => { insightsAssistantNow.enabled = false; insightsAssistantNow.reason = 'no_provider' })
  await screen.findByRole('table', { name: 'Reports' })
  expect(screen.queryByRole('region', { name: 'Ask for a Report' })).toBeNull()
})

test('Settings → AI Assistant: the switch, the providers people may pick, Explain, and the month’s prompts; each change is one PUT', async () => {
  const calls = await renderAppAt('/settings/ai-assistant')
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'AI Assistant' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'AI Assistant' })).toBeTruthy()                                     // the Settings menu
  expect(screen.getByText('38 of 200')).toBeTruthy()
  await user.click(screen.getByRole('switch', { name: 'Allow OpenAI' }))
  expect(calls.find((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT')?.body).toEqual({ providers: { openai: false } })
  await user.click(screen.getByRole('switch', { name: 'Use AI in Reports' }))
  expect(calls.filter((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT').at(-1)?.body).toEqual({ enabled: false })
  expect(await screen.findByText(/Off\. Reports are built in the editor only/)).toBeTruthy()
  expect((screen.getByRole('switch', { name: 'Allow Claude (Anthropic)' }) as HTMLButtonElement).disabled).toBe(true)
})

test('a workspace adds its own key for a provider: the form, one PUT with the key and models, the provider then on the own key with Check Connection and a way back', async () => {
  const calls = await renderAppAt('/settings/ai-assistant')
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'AI Assistant' })
  const openai = screen.getByRole('listitem', { name: 'OpenAI' })
  expect(within(openai).getByText('Provided by the Platform')).toBeTruthy()
  await user.click(within(openai).getByRole('button', { name: 'Use Your Own Key' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Your Own OpenAI Key' })
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(within(dialog).getByText('Give the provider’s API key.')).toBeTruthy()                            // nothing sent without a key
  await user.type(within(dialog).getByLabelText(/API Key/), 'sk-own-test')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  const put = calls.filter((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT').at(-1)?.body as Record<string, unknown>
  expect(put).toEqual({ own: { openai: { api_key: 'sk-own-test', model_reports: 'gpt-5', model_fast: 'gpt-5-mini' } } })
  const after = await screen.findByRole('listitem', { name: 'OpenAI' })
  expect(within(after).getByText('Not Checked Yet')).toBeTruthy()
  expect(within(after).getByText(/Your own key · gpt-5, gpt-5-mini/)).toBeTruthy()
  expect(within(after).queryByRole('switch', { name: 'Allow OpenAI' })).toBeNull()                         // the own key wins; nothing to allow
  await user.click(within(after).getByRole('button', { name: 'Check Connection' }))
  expect(await within(screen.getByRole('listitem', { name: 'OpenAI' })).findByText(/Checked/)).toBeTruthy()
  expect(calls.find((call) => call.url.endsWith('/workspace/ai-assistant/check/'))?.body).toEqual({ provider: 'openai' })
  expect(within(screen.getByRole('listitem', { name: 'OpenAI' })).getByRole('button', { name: 'Use the Platform’s Key' })).toBeTruthy()
})

test('a long prompt over several lines with images: the paperclip takes up to five PNG, JPEG, GIF or WebP files, refuses other kinds, shows them to remove, and Generate sends them with the prompt', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup({ applyAccept: false })
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  const prompt = within(box).getByRole('textbox', { name: 'What do you want to see?' }) as HTMLTextAreaElement
  expect(prompt.maxLength).toBe(100_000)
  await user.type(prompt, 'Net sales by store, like the sketch{Shift>}{Enter}{/Shift}- one bar per store{Shift>}{Enter}{/Shift}- last quarter')
  expect(prompt.value).toBe('Net sales by store, like the sketch\n- one bar per store\n- last quarter')
  expect(within(box).queryByText(/ \/ 100,000/)).toBeNull()                                   // the counter shows only near the end

  const picker = box.querySelector('input[type="file"]') as HTMLInputElement
  const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
  await user.upload(picker, [new File(['zip'], 'budget.zip', { type: 'application/zip' })])
  expect(within(box).getByRole('alert').textContent).toBe('budget.zip is not an image (PNG, JPEG, GIF, WebP) or a document (PDF, Word, Excel, CSV, text, Markdown).')
  await user.upload(picker, [png('sketch.png'), png('chart.png'), png('table.png'), png('bars.png'), png('pie.png'), png('sixth.png')])
  expect(within(box).getByRole('alert').textContent).toBe('Add up to 5 images. sixth.png was not added.')
  const shown = within(box).getByRole('list', { name: 'Images' })
  expect(within(shown).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['sketch.png', 'chart.png', 'table.png', 'bars.png', 'pie.png'])
  expect(within(box).getByText('5 images')).toBeTruthy()
  for (const name of ['bars.png', 'pie.png']) await user.click(within(shown).getByRole('button', { name: `Remove ${name}` }))
  await user.click(within(shown).getByRole('button', { name: 'Remove chart.png' }))
  expect(within(shown).getAllByRole('img')).toHaveLength(2)
  expect(within(box).getByText(/Sends your prompt, the images and the field names/)).toBeTruthy()

  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  await screen.findByRole('region', { name: 'Draft Report' })
  const sent = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.form
  expect(sent?.get('prompt')).toBe('Net sales by store, like the sketch\n- one bar per store\n- last quarter')
  expect(sent?.get('model')).toBe('anthropic:claude-sonnet-5-5')
  expect(((sent?.getAll('images') ?? []) as File[]).map((file) => file.name)).toEqual(['sketch.png', 'table.png'])
})

test('files dragged over the panel show the drop target; dropping adds the images, and a file that is not one is refused', async () => {
  await renderAppAt('/insights/reports')
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect(within(box).getByText('Drop, paste or attach up to 5 images and 3 documents')).toBeTruthy()
  const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
  const carrying = (files: File[]) => ({ dataTransfer: { files, types: ['Files'], dropEffect: 'none' } })

  fireEvent.dragOver(within(box).getByRole('heading', { name: 'Ask for a Report' }), carrying([png('sketch.png')]))
  expect(within(box).getByText('Drop images or documents here')).toBeTruthy()
  fireEvent.dragLeave(box, { relatedTarget: document.body })
  expect(within(box).queryByText('Drop images or documents here')).toBeNull()

  fireEvent.dragOver(box, carrying([png('sketch.png'), png('chart.png')]))
  fireEvent.drop(within(box).getByRole('textbox', { name: 'What do you want to see?' }), carrying([png('sketch.png'), png('chart.png')]))
  expect(within(box).queryByText('Drop images or documents here')).toBeNull()
  const shown = await within(box).findByRole('list', { name: 'Images' })
  expect(within(shown).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['sketch.png', 'chart.png'])
  expect(within(box).getByText('2 images')).toBeTruthy()

  fireEvent.drop(box, carrying([new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })]))
  const documents = await within(box).findByRole('list', { name: 'Documents' })
  expect(within(documents).getByText('plan.pdf')).toBeTruthy()
  expect(within(box).getByText('1 document · 2 images')).toBeTruthy()
  fireEvent.drop(box, carrying([new File(['x'], 'slides.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })]))
  expect((await within(box).findByRole('alert')).textContent).toMatch(/^slides\.pptx is not an image/)
  expect(within(shown).getAllByRole('img')).toHaveLength(2)

  fireEvent.dragOver(box, { dataTransfer: { files: [], types: ['text/plain'], dropEffect: 'none' } })
  expect(within(box).queryByText('Drop images or documents here')).toBeNull()
})

test('documents beside images: a Word spec and a PDF go with the prompt as documents, a fourth is refused, and the draft says what it read', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup({ applyAccept: false })
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  const picker = box.querySelector('input[type="file"]') as HTMLInputElement
  const file = (name: string, type: string) => new File(['spec'], name, { type })
  await user.upload(picker, [file('Store sales spec v3.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), file('Regional KPIs.pdf', 'application/pdf'),
    file('notes.md', ''), file('extra.txt', 'text/plain')])
  expect(within(box).getByRole('alert').textContent).toBe('Add up to 3 documents. extra.txt was not added.')
  const listed = within(box).getByRole('list', { name: 'Documents' })
  expect(within(listed).getAllByRole('listitem').map((item) => item.getAttribute('title'))).toEqual(['Store sales spec v3.docx', 'Regional KPIs.pdf', 'notes.md'])
  expect(within(listed).getByText('Word · 1 KB')).toBeTruthy()
  await user.click(within(listed).getByRole('button', { name: 'Remove notes.md' }))
  expect(within(box).getByText(/Sends your prompt, the documents and the field names, never your data\. Documents are not kept\./)).toBeTruthy()
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Build the report in the spec')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  const sent = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.form
  expect(((sent?.getAll('documents') ?? []) as File[]).map((f) => f.name)).toEqual(['Store sales spec v3.docx', 'Regional KPIs.pdf'])
  expect(sent?.get('scope')).toBeNull()                                                          // All My Data is the default, not sent
  expect(within(card).getByText(/read Store sales spec v3\.docx \(Word\) and Regional KPIs\.pdf \(PDF\)/)).toBeTruthy()
})

test('Ask About: the data to ask about, remembered; a database with its tables not mapped yet gives a draft that says so, and Open in Editor maps it', async () => {
  const calls = await renderAppAt('/insights/reports', withInsights, () => {
    reportDatabasesNow.push({ id: 'db-cg', name: 'CG-Prod', engine: 'mysql57', engine_name: 'MySQL 5.7', host: 'db', port: 3306, database_name: 'shop', schema_name: 'shop', username: 'r', ssl_mode: 'REQUIRED',
      status: 'ACTIVE', last_tested_at: null, last_test_ok: true, last_test_error: null, read_only: true, server_version: '5.7.44', server_timezone: 'UTC', created_at: '2026-10-20T09:00:00Z',
      updated_at: '2026-10-20T09:00:00Z', row_version: 1, usable: true, datasets: [], limit_profile: 'LIVE', query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 60, concurrent: 1 }, pinned_tables: [] })
  })
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  await user.click(within(box).getByRole('button', { name: /All My Data/ }))
  const menu = await screen.findByRole('region', { name: 'Data to Ask About' })
  expect(within(menu).getByRole('button', { name: /C360/ })).toBeTruthy()
  await user.click(await within(menu).findByRole('button', { name: /CG-Prod/ }))
  expect(within(menu).getByRole('checkbox', { name: 'Also Look at Tables Not Mapped Yet' })).toHaveProperty('checked', true)
  expect(window.localStorage.getItem('insights.ai.scope')).toBe('db:db-cg')
  expect(within(box).getAllByRole('button', { name: /CG-Prod/ })[0].textContent).toContain('0 datasets · and its tables')         // the trigger, before the open menu
  expect(within(box).getByText(/the names of CG-Prod’s fields and tables, never your data/)).toBeTruthy()
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Net sales by store and week')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  const asked = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.body as Record<string, unknown>
  expect(asked).toEqual({ prompt: 'Net sales by store and week', model: 'anthropic:claude-sonnet-5-5', scope: 'db:db-cg', unmapped: true })
  expect(within(card).getByText('Not Mapped Yet')).toBeTruthy()
  expect(within(card).getByText(/CG-Prod · sales_lines \+ stores/)).toBeTruthy()
  expect(within(card).getByText('Store')).toBeTruthy()                                          // Rows, in the new dataset's words
  expect(within(card).getByText('The spec asks for stores open all quarter; the tables have no opening date.')).toBeTruthy()
  expect(within(card).getByText(/Open in Editor maps sales_lines joined to stores as the dataset “Store Sales” \(3 fields\)/)).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'Open in Editor' }))
  expect(calls.some((call) => call.url.endsWith('/insights/assistant/ask-new/open/') && call.method === 'POST')).toBe(true)
})

test('a remembered database that is gone falls back to All My Data; the counter shows from 90,000 characters', async () => {
  window.localStorage.setItem('insights.ai.scope', 'db:gone')
  await renderAppAt('/insights/reports')
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect(await within(box).findByRole('button', { name: /All My Data/ })).toBeTruthy()
  const prompt = within(box).getByRole('textbox', { name: 'What do you want to see?' })
  fireEvent.change(prompt, { target: { value: 'x'.repeat(89_999) } })
  expect(within(box).queryByText(/ \/ 100,000/)).toBeNull()
  fireEvent.change(prompt, { target: { value: 'x'.repeat(96_140) } })
  expect(within(box).getByText('96,140 / 100,000')).toBeTruthy()
})

test('an Excel workbook and a CSV go with the prompt as documents, shown as Excel and CSV', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup({ applyAccept: false })
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  const picker = box.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(picker, [new File(['xlsx'], 'Store targets.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), new File(['week,target'], 'weeks.csv', { type: 'text/csv' })])
  const listed = within(box).getByRole('list', { name: 'Documents' })
  expect(within(listed).getByText('Excel · 1 KB')).toBeTruthy()
  expect(within(listed).getByText('CSV · 1 KB')).toBeTruthy()
  expect(within(box).queryByRole('alert')).toBeNull()
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Net sales against the targets in the workbook')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  const sent = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.form
  expect(((sent?.getAll('documents') ?? []) as File[]).map((f) => f.name)).toEqual(['Store targets.xlsx', 'weeks.csv'])
  expect(within(card).getByText(/read Store targets\.xlsx \(Excel\)/)).toBeTruthy()
})
