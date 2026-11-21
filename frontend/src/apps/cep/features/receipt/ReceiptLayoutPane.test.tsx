import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import type { ReceiptSection } from '@/lib/types'

import { ReceiptLayoutPane, type ReceiptLayoutConfig } from './ReceiptLayoutPane'
import { defaultSectionsFor } from './receiptPresets'
import { STARTER_CUSTOM_HTML, STARTER_ITEM_ROW, defaultRegisterSettings } from './registerSettings'

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
  expect(Object.keys(config)).toEqual(expect.arrayContaining(['custom_css', 'custom_html', 'layout_preset', 'sections']))
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

test('Custom HTML starts from a working table with its Item Row, and has a box each for the Receipt, the Item Row and the CSS', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Custom HTML/))

  expect(last(onChange)).toMatchObject({ layout_preset: 'CUSTOM_HTML', custom_html: STARTER_CUSTOM_HTML, custom_css: '', item_row: STARTER_ITEM_ROW })
  expect(screen.getByLabelText('Receipt HTML').tagName).toBe('TEXTAREA')
  expect(screen.queryByTestId('receipt')).toBeNull()
  expect(screen.queryByRole('complementary', { name: 'Section Settings' })).toBeNull()
  expect(within(screen.getByRole('list', { name: 'Checks' })).getAllByRole('listitem').length).toBeGreaterThan(2)

  await user.clear(screen.getByLabelText('Receipt HTML'))
  await user.type(screen.getByLabelText('Receipt HTML'), '<p>Hi</p>')
  expect(last(onChange).custom_html).toBe('<p>Hi</p>')
  await user.click(screen.getByRole('radio', { name: 'Item Row' }))
  expect((screen.getByLabelText('Item Row') as HTMLTextAreaElement).value).toBe(STARTER_ITEM_ROW)
  await user.click(screen.getByRole('radio', { name: 'CSS' }))
  expect(screen.getByLabelText('CSS').tagName).toBe('TEXTAREA')
  expectComplete(last(onChange))
})

test('Store Register: renamed headers, an added column and footer text reach the receipt; a sixth column cannot be added', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Store Register/))
  expect(last(onChange).register).toEqual(defaultRegisterSettings())

  expect(screen.queryByLabelText('Header: Description')).toBeNull()                                       // one line per column until Edit
  await user.click(screen.getByRole('button', { name: 'Edit Column: Description' }))
  await user.clear(screen.getByLabelText('Header: Description'))
  await user.type(screen.getByLabelText('Header: Description'), 'Item')
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByLabelText('Header: Description')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Add Column' }))
  await user.click(within(screen.getByRole('list', { name: 'Add Column' })).getByRole('button', { name: /Size/ }))
  expect(last(onChange).register?.columns.map((column) => column.key)).toEqual(['description', 'size', 'amount'])
  expect(screen.getByLabelText('Shows: Size')).toBeTruthy()                                               // the added column opens for editing
  expect(screen.getAllByRole('combobox', { name: /^Shows:/ })).toHaveLength(1)                            // and only it: no box twice per column
  const html = screen.getByTestId('register-preview').innerHTML
  expect(html).toContain('>Item</td>')
  expect(html).toContain('>Size</td>')

  for (const name of [/Colour/, /Quantity/]) {
    await user.click(screen.getByRole('button', { name: 'Add Column' }))
    await user.click(within(screen.getByRole('list', { name: 'Add Column' })).getByRole('button', { name }))
  }
  expect(screen.getByRole('button', { name: 'Add Column' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/At most 5 columns/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /Footer Text/ }))
  await user.type(screen.getByLabelText('Text'), 'Returns within 30 days.')
  expect(last(onChange).register?.footer_text).toBe('Returns within 30 days.')
  expect(screen.getByTestId('register-preview').innerHTML).toContain('Returns within 30 days.')

  await user.click(screen.getByRole('button', { name: /Title & Header/ }))
  await user.click(screen.getAllByRole('checkbox', { name: 'Show' })[1])
  expect(last(onChange).register?.fields[1]).toMatchObject({ key: 'register', visible: false })
  expect(screen.getByTestId('register-preview').innerHTML).not.toContain('Register:</span>')
})

test('Store Register: a renamed column says what it shows; Shows changes what it prints', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Store Register/))
  await user.click(screen.getByRole('button', { name: 'Add Column' }))
  await user.click(within(screen.getByRole('list', { name: 'Add Column' })).getByRole('button', { name: /Quantity/ }))
  await user.selectOptions(screen.getByLabelText('Shows: Quantity'), 'discount')
  expect(last(onChange).register?.columns[1]).toEqual({ key: 'discount', label: 'Discount' })
  await user.clear(screen.getByLabelText('Header: Discount'))
  await user.type(screen.getByLabelText('Header: Discount'), 'Savings')
  await user.click(screen.getByRole('button', { name: 'Done' }))
  const columns = screen.getByRole('list', { name: 'Columns' })
  expect(within(columns).getByText('Savings')).toBeTruthy()
  expect(within(columns).getByText('Shows Discount')).toBeTruthy()
})

test('Store Register: Totals & Tenders rows are renamed, hidden and added, and print in their order', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Store Register/))
  await user.click(screen.getByRole('button', { name: /Totals & Tenders/ }))
  await user.clear(screen.getByLabelText('Label: Subtotal'))
  await user.type(screen.getByLabelText('Label: Subtotal'), 'Sub-Total')
  await user.click(screen.getByRole('checkbox', { name: 'With the authorisation (Auth: 096837)' }))
  await user.click(screen.getByRole('button', { name: 'Add Row' }))
  await user.click(within(screen.getByRole('list', { name: 'Add Row' })).getByRole('button', { name: /Points Balance/ }))
  await user.click(screen.getByRole('button', { name: 'Add Row' }))
  await user.click(within(screen.getByRole('list', { name: 'Add Row' })).getByRole('button', { name: /Items Sold/ }))
  const totals = last(onChange).register?.totals
  expect(totals?.rows.map((row) => row.key)).toEqual(['subtotal', 'taxes', 'total', 'tenders', 'change', 'items', 'points_balance'])
  expect(totals?.tender_auth).toBe(false)
  const html = screen.getByTestId('register-preview').innerHTML
  expect(html).toContain('Sub-Total:</td>')
  expect(html).toContain('Items Sold:</td>')
  expect(html).not.toContain('Auth:')
  await user.click(screen.getByRole('radio', { name: 'Label Left' }))
  expect(screen.getByTestId('register-preview').innerHTML).toContain('>Sub-Total</td>')
  await user.click(screen.getByRole('button', { name: 'Remove Row: Items Sold' }))
  expect(last(onChange).register?.totals?.rows.map((row) => row.key)).not.toContain('items')
  expect(screen.queryByRole('button', { name: 'Remove Row: Subtotal' })).toBeNull()                       // the register's own rows hide, never go
})

test('Store Register: Colours & Text sets a theme, a colour of its own, the font and the size', async () => {
  const { onChange, user } = setup()
  await user.click(preset(/Store Register/))
  await user.click(screen.getByRole('button', { name: /Colours & Text/ }))
  await user.click(screen.getByRole('radio', { name: /Ink/ }))
  expect(last(onChange).register?.style).toMatchObject({ theme: 'INK', colors: null })
  expect(screen.getByTestId('register-preview').innerHTML).toContain('background-color:#1f1f1f')
  expect(screen.getByTestId('register-preview').innerHTML).toContain('color:#ffffff;font-weight:700;')     // headers on the dark band turn white
  await user.click(screen.getByRole('button', { name: 'Customise Colours' }))
  const hex = screen.getByLabelText('Discounts and Savings Hex')
  await user.clear(hex)
  await user.type(hex, '#C0392B{Enter}')
  expect(last(onChange).register?.style?.colors).toMatchObject({ frame: '#1f1f1f', accent: '#c0392b' })
  expect(screen.getByRole('radio', { name: /Ink/ }).getAttribute('aria-checked')).toBe('false')
  await user.click(screen.getByRole('radio', { name: 'Courier' }))
  await user.click(screen.getByRole('radio', { name: 'Large' }))
  await user.click(screen.getByRole('checkbox', { name: 'Column headers in capitals' }))
  expect(last(onChange).register?.style).toMatchObject({ font: 'COURIER', size: 'L', upper_headers: true })
  const html = screen.getByTestId('register-preview').innerHTML
  expect(html).toContain("font-family:'Courier New', Courier, monospace")
  expect(html).toContain('text-transform:uppercase')
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
