/**
 * rte.insertHTML from a popover outside the canvas frame looks right and is undone by the next keystroke
 * (measured, September 2026). Every tag goes in through insertAtCaret instead. This fails the moment anyone
 * reaches for the old call again.
 */
import { expect, test } from 'vitest'

import designer from '../EmailDesigner.tsx?raw'
import workspace from '../DesignerWorkspace.tsx?raw'
import textField from '../inspector/fields/TextField.tsx?raw'
import tagsPanel from './TagsPanel.tsx?raw'

test.each([
  ['EmailDesigner', designer],
  ['DesignerWorkspace', workspace],
  ['TextField', textField],
  ['TagsPanel', tagsPanel],
])('%s never inserts a tag through execCommand', (_name, source) => {
  expect(source).not.toMatch(/insertHTML|execCommand/)
})

test('the canvas path and the header path both go through insertAtCaret', () => {
  expect(designer).toContain('insertAtCaret(')
  expect(designer).not.toContain('globalRte')
})
