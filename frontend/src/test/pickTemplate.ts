import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

/** the Content step: open Choose a Template, pick a card and confirm with Use Template */
export async function pickTemplate(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(await screen.findByRole('button', { name: /^(Change|Choose a Template)$/ }))
  const drawer = await screen.findByRole('dialog', { name: 'Choose a Template' })
  await user.click(within(drawer).getByRole('radio', { name }))
  await user.click(within(drawer).getByRole('button', { name: 'Use Template' }))
}

/** a design-system dropdown: open the field's trigger (its name starts with the label) and choose an option */
export async function pickFromMenu(user: ReturnType<typeof userEvent.setup>, field: RegExp, option: RegExp | string) {
  await user.click(await screen.findByRole('button', { name: field }))
  await user.click(await screen.findByRole('option', { name: option }))
}
