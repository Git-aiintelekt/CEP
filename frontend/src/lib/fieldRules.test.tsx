import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { Counter, Field, TextInput } from '@/components/Form'
import { session } from '@/lib/api'
import { limitTone, ruleAt, stringFromRule, useFieldRules } from '@/lib/fieldRules'
import type { FieldRule } from '@/lib/types'
import { installMockApi } from '@/test/mockApi'

afterEach(() => { cleanup(); session.clear() })

const text = (max: number | null): FieldRule => ({ type: 'string', required: false, max })

test('the tone: grey with room, amber in the last 10%, red at the limit; a soft limit counts first; no limit, no tone', () => {
  expect(limitTone({ used: 15, max: 200 })).toBe('quiet')
  expect(limitTone({ used: 180, max: 200 })).toBe('warn')
  expect(limitTone({ used: 200, max: 200 })).toBe('over')
  expect(limitTone({ used: 60, max: 300, soft: 60 })).toBe('over')
  expect(limitTone({ used: 55, max: 300, soft: 60 })).toBe('warn')
  expect(limitTone({ used: 39, max: 40 })).toBe('warn')
  expect(limitTone({ used: 5000, max: null })).toBe('quiet')
})

test('the counter reads "42 / 200", says so to a screen reader, and is absent when the limit is unknown', () => {
  const { container, rerender } = render(<Counter used={42} max={200} />)
  expect(screen.getByLabelText('42 of 200 characters').textContent).toBe('42 / 200')
  rerender(<Counter used={1250} max={2000} />)
  expect(screen.getByLabelText('1,250 of 2,000 characters').textContent).toBe('1,250 / 2,000')
  rerender(<Counter used={200} max={200} />)
  expect(screen.getByLabelText('200 of 200 characters').className).toContain('text-danger-text')
  rerender(<Counter used={10} max={null} />)
  expect(container.textContent).toBe('')
})

test('a Field shows its limit at the end of the label row, beside any other label-end content', () => {
  render(
    <Field label="Subject Line" limit={{ used: 12, max: 300, soft: 60 }} labelEnd={<button type="button">Use the Template's</button>}>
      {(ids) => <TextInput {...ids} defaultValue="Fall is here" />}
    </Field>,
  )
  expect(screen.getByRole('button', { name: "Use the Template's" })).toBeTruthy()
  expect(screen.getByLabelText('12 of 60 characters')).toBeTruthy()
})

test('rules are walked by dotted path and turned into Zod checks with the forms’ wording', () => {
  const fields = { name: text(200), targets: { type: 'object', required: false, fields: { notes: text(1000) } } as FieldRule }
  expect(ruleAt(fields, 'targets.notes')?.max).toBe(1000)
  expect(ruleAt(fields, 'targets.missing')).toBeNull()
  expect(ruleAt(undefined, 'name')).toBeNull()
  const name = stringFromRule(text(200))
  expect(name.safeParse('x'.repeat(201)).success).toBe(false)
  expect(name.safeParse('x'.repeat(201)).error?.issues[0].message).toBe('Use 200 characters or fewer.')
  expect(stringFromRule(null, 40).safeParse('x'.repeat(41)).success).toBe(false)
  expect(stringFromRule({ type: 'email', required: true }).safeParse('marketing@northline').success).toBe(false)
  expect(stringFromRule({ type: 'email', required: true }).safeParse('marketing@northline.example').success).toBe(true)
})

test('useFieldRules reads the server’s rules once and answers per field', async () => {
  installMockApi()
  session.setTokens({ access: 'access-1', refresh: 'refresh-1' })
  const client = new QueryClient()
  function Probe() {
    const rule = useFieldRules('campaign')
    return <p>{rule('name')?.max ?? 'none'} · {rule('description')?.max === null ? 'unlimited' : 'limited'} · {rule('nope') ? 'found' : 'missing'}</p>
  }
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByText('200 · unlimited · missing')).toBeTruthy())
})
