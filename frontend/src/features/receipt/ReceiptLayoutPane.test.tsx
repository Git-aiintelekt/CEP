import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import type { ReceiptSection } from '@/lib/types'

import { ReceiptLayoutPane, type ReceiptLayoutConfig } from './ReceiptLayoutPane'
import { defaultSectionsFor } from './receiptPresets'

afterEach(cleanup)

const KEYS = ['header', 'customer_fulfillment', 'items', 'totals', 'payment', 'loyalty', 'support']

/** Holds the layout the way the workspace will, and records every config handed back. */
function Harness({ onChange }: { onChange: (next: ReceiptLayoutConfig) => void }) {
  const [layout, setLayout] = useState<ReceiptLayoutConfig>({ layout_preset: 'STANDARD', sections: defaultSectionsFor('STANDARD'), custom_html: null, custom_css: null })
  return (
    <ReceiptLayoutPane
      layout={layout}
      onChange={(next) => {
        onChange(next)
        setLayout(next)
      }}
    />
  )
}

function setup() {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)
  return { onChange, user }
}

const preset = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Presentation' })).getByRole('radio', { name })
const rows = () => [...document.querySelectorAll('[data-section-row]')].map((node) => node.getAttribute('data-section-row'))
const previewed = () => [...document.querySelectorAll('[data-section]')].map((node) => node.getAttribute('data-section'))
const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0] as ReceiptLayoutConfig

/** A complete config: every field present, seven sections with orders 0 to 6. */
function expectComplete(config: ReceiptLayoutConfig) {
  expect(Object.keys(config).sort()).toEqual(['custom_css', 'custom_html', 'layout_preset', 'sections'])
  expect(config.sections.map((section) => section.key).sort()).toEqual([...KEYS].sort())
  expect(config.sections.map((section) => section.order).sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
}

test('choosing a preset rewrites the section list and the receipt', async () => {
  const { onChange, user } = setup()
  expect(previewed()).toContain('loyalty')

  await user.click(preset(/Compact/))
  expect(last(onChange).layout_preset).toBe('COMPACT')
  expect(last(onChange).sections).toEqual(defaultSectionsFor('COMPACT'))
  expect(previewed()).toEqual(['header', 'items', 'totals', 'payment'])
  expect(document.querySelector('[data-section-row="loyalty"]')?.hasAttribute('data-hidden')).toBe(true)
  expectComplete(last(onChange))
})

test('switching a section off greys its row and takes it off the receipt', async () => {
  const { onChange, user } = setup()
  await user.click(screen.getByRole('switch', { name: 'Show Payment' }))

  expect(document.querySelector('[data-section-row="payment"]')?.hasAttribute('data-hidden')).toBe(true)
  expect(previewed()).not.toContain('payment')
  expectComplete(last(onChange))
})

test('locked sections carry a lock, not a switch', () => {
  setup()
  for (const label of ['Order Header', 'Items', 'Totals']) {
    expect(screen.getByRole('img', { name: `${label} is always shown` })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: `Show ${label}` })).toBeNull()
  }
})

test('every row moves, the locked ones included; only the ends are disabled', async () => {
  const { onChange, user } = setup()
  expect((screen.getByRole('button', { name: 'Move Up: Order Header' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Move Down: Returns & Support' }) as HTMLButtonElement).disabled).toBe(true)

  await user.click(screen.getByRole('button', { name: 'Move Up: Totals' }))
  expect(rows()).toEqual(['header', 'customer_fulfillment', 'totals', 'items', 'payment', 'loyalty', 'support'])
  await user.click(screen.getByRole('button', { name: 'Move Down: Order Header' }))
  expect(rows()[0]).toBe('customer_fulfillment')
  await user.click(screen.getByRole('button', { name: 'Move Up: Items' }))
  expect(previewed()).toEqual(['customer_fulfillment', 'header', 'items', 'totals', 'payment', 'loyalty', 'support'])
  expectComplete(last(onChange))

  for (const label of ['Order Header', 'Customer & Fulfillment', 'Items', 'Totals', 'Payment', 'Loyalty', 'Returns & Support']) {
    const up = screen.getByRole('button', { name: `Move Up: ${label}` }) as HTMLButtonElement
    const down = screen.getByRole('button', { name: `Move Down: ${label}` }) as HTMLButtonElement
    const index = rows().indexOf(KEYS[['Order Header', 'Customer & Fulfillment', 'Items', 'Totals', 'Payment', 'Loyalty', 'Returns & Support'].indexOf(label)])
    expect(up.disabled, label).toBe(index === 0)
    expect(down.disabled, label).toBe(index === 6)
  }
})

test('the right panel offers the selected section its own settings', async () => {
  const { user } = setup()
  const panel = () => screen.getByRole('complementary', { name: 'Section Settings' })

  expect(within(panel()).getByRole('heading', { name: 'Items' })).toBeTruthy()
  expect(within(panel()).getByText('Mapped to Order.lineItems[]')).toBeTruthy()
  expect(within(panel()).getByRole('radiogroup', { name: 'Row Height' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Customer & Fulfillment' }))
  expect(within(panel()).getByLabelText('Address Shown')).toBeTruthy()
  expect(within(panel()).queryByRole('radiogroup', { name: 'Row Height' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Payment' }))
  expect(within(panel()).getByText('Always masked to the last four digits')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Returns & Support' }))
  expect(within(panel()).getByLabelText('Policy Text')).toBeTruthy()
  expect(within(panel()).queryByText(/Mapped to/)).toBeNull()
})

test('a settings change reaches the receipt at once', async () => {
  const { onChange, user } = setup()
  await user.click(screen.getByRole('button', { name: 'Totals' }))
  expect(document.querySelector('[data-section="totals"]')?.textContent).toContain('Tax')

  await user.click(screen.getByRole('switch', { name: 'Tax' }))
  expect(document.querySelector('[data-section="totals"]')?.textContent).not.toContain('Tax')
  const totals = last(onChange).sections.find((section) => section.key === 'totals') as Extract<ReceiptSection, { key: 'totals' }>
  expect(totals.rows.tax).toBe(false)
  expectComplete(last(onChange))

  await user.click(screen.getByRole('button', { name: 'Items' }))
  await user.click(screen.getByRole('radio', { name: 'Compact' }))
  expect((last(onChange).sections.find((section) => section.key === 'items') as Extract<ReceiptSection, { key: 'items' }>).row_height).toBe('COMPACT')
})

test('Custom HTML swaps the layout for an HTML and a CSS box', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Custom HTML/))

  expect(last(onChange)).toMatchObject({ layout_preset: 'CUSTOM_HTML', custom_html: '', custom_css: '' })
  expect(screen.getByLabelText('HTML').tagName).toBe('TEXTAREA')
  expect(screen.getByLabelText('CSS').tagName).toBe('TEXTAREA')
  expect(screen.queryByTestId('receipt')).toBeNull()
  expect(screen.queryByRole('complementary', { name: 'Section Settings' })).toBeNull()

  await user.type(screen.getByLabelText('HTML'), '<p>Hi</p>')
  expect(last(onChange).custom_html).toBe('<p>Hi</p>')
  expectComplete(last(onChange))
})

test('the email shell switch wraps the receipt', async () => {
  const { user } = setup()
  expect(screen.queryByTestId('email-shell')).toBeNull()
  await user.click(screen.getByRole('switch', { name: 'Show Inside Email Shell' }))
  expect(screen.getByTestId('email-shell')).toBeTruthy()
})

test('read-only changes nothing', () => {
  render(<ReceiptLayoutPane layout={{ layout_preset: 'STANDARD', sections: defaultSectionsFor('STANDARD'), custom_html: null, custom_css: null }} onChange={vi.fn()} readOnly />)
  expect((preset(/Compact/) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Move Down: Items' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('switch', { name: 'Show Payment' }) as HTMLButtonElement).disabled).toBe(true)
})
