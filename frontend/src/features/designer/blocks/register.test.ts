import type { Component, Editor } from 'grapesjs'
import { expect, test, vi } from 'vitest'

import { ONE_FOOTER_NOTICE, applyFooterRules, blockContent, blockIdsInOrder, isFooter, registerBlocks, setBlockImage } from './register'
import { ASSET_IMAGE_TOKEN, COLUMN_PADDING } from './brand'
import { BLOCK_CATEGORIES, CEP_BLOCKS, needsImage, withImage } from './registry'

interface Added {
  id: string
  props: { label: string; category: string; content: string; attributes: Record<string, string> }
}

/** Only the one method registerBlocks touches; anything else it reached for would throw here. */
function mockEditor(): { editor: Editor; added: Added[] } {
  const added: Added[] = []
  const add = vi.fn((id: string, props: Added['props']) => {
    added.push({ id, props })
    return props
  })
  return { editor: { Blocks: { add } } as unknown as Editor, added }
}

test('every block is registered once, in palette order', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL' })

  expect(added).toHaveLength(CEP_BLOCKS.length)
  expect(added.map((item) => item.id)).toEqual(CEP_BLOCKS.map((block) => block.id))
  expect(new Set(added.map((item) => item.id)).size).toBe(added.length)
})

test('each block keeps its label, its MJML and its icon', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL' })

  for (const block of CEP_BLOCKS) {
    const entry = added.find((item) => item.id === block.id)
    expect(entry, block.id).toBeDefined()
    expect(entry?.props.label, block.id).toBe(block.label)
    expect(entry?.props.content, block.id).toBe(needsImage(block) ? withImage(block, '') : block.mjml)
    expect(entry?.props.attributes, block.id).toEqual({ 'data-icon': block.icon })
  }
})

test('the category is the sentence-case label, not the id', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL' })

  const labelOf = new Map(BLOCK_CATEGORIES.map((category) => [category.id, category.label]))
  for (const block of CEP_BLOCKS) {
    const entry = added.find((item) => item.id === block.id)
    expect(entry?.props.category, block.id).toBe(labelOf.get(block.category))
  }
  expect(new Set(added.map((item) => item.props.category))).toEqual(new Set(['Structure', 'Content', 'Brand', 'Commerce']))
})

test('a receipt is offered no footer, because it carries no unsubscribe link', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'E_RECEIPT' })

  expect(added.map((item) => item.id)).not.toContain('footer')
  expect(added).toHaveLength(CEP_BLOCKS.length - 1)
})

test('blockIdsInOrder matches what was registered', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL' })

  expect(blockIdsInOrder('EMAIL')).toEqual(added.map((item) => item.id))
  expect(blockIdsInOrder('E_RECEIPT')).not.toContain('footer')
})

// ---- footer rules --------------------------------------------------------

interface FakeComponent {
  attrs: Record<string, string>
  classes: string[]
  props: Record<string, unknown>
  removed: boolean
}

/** The toolbar GrapesJS gives an mj-section, built before any of our flags are set. */
const FULL_TOOLBAR = [{ command: null }, { command: 'tlb-move' }, { command: 'tlb-clone' }, { command: 'tlb-delete' }]

function component(attrs: Record<string, string> = {}, classes: string[] = []): FakeComponent & Component {
  const self: FakeComponent = { attrs, classes, props: { toolbar: [...FULL_TOOLBAR] }, removed: false }
  return Object.assign(self, {
    getAttributes: () => self.attrs,
    getClasses: () => self.classes,
    get: (key: string) => self.props[key],
    set: (keyOrValues: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrValues === 'string') self.props[keyOrValues] = value
      else Object.assign(self.props, keyOrValues)
    },
    remove: () => {
      self.removed = true
    },
  }) as unknown as FakeComponent & Component
}

const commandsOf = (item: FakeComponent) => (item.props.toolbar as { command: string | null }[]).map((entry) => entry.command)
const untouched = (item: FakeComponent) => {
  expect(item.props.removable).toBeUndefined()
  expect(item.props.copyable).toBeUndefined()
  expect(commandsOf(item)).toEqual([null, 'tlb-move', 'tlb-clone', 'tlb-delete'])
}

/** A canvas that holds components and lets the rules listen to component:add, which the test fires by hand. */
function fakeEditor(initial: (FakeComponent & Component)[] = []) {
  const canvas = [...initial]
  const listeners: ((component: Component) => void)[] = []
  const editor = {
    on: (event: string, handler: (component: Component) => void) => {
      if (event === 'component:add') listeners.push(handler)
    },
    getWrapper: () => ({ onAll: (visit: (component: Component) => void) => canvas.forEach(visit) }),
  } as unknown as Editor
  const add = (item: FakeComponent & Component) => {
    canvas.push(item)
    listeners.forEach((handler) => handler(item))
  }
  return { editor, canvas, add }
}

const footer = () => component({ 'css-class': 'cep-footer' })
/** the rules push the refusal past the in-flight drop, so the assertions wait one turn too */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const rules = (editor: Editor, over: Partial<Parameters<typeof applyFooterRules>[1]> = {}) =>
  applyFooterRules(editor, { channel: 'EMAIL', isLoading: () => false, ...over })

test('a footer is recognised by its css-class attribute or by a real class', () => {
  expect(isFooter(footer())).toBe(true)
  expect(isFooter(component({}, ['cep-footer']))).toBe(true)
  expect(isFooter(component({ 'css-class': 'wide cep-footer' }))).toBe(true)
  expect(isFooter(component({ 'css-class': 'cep-footer-ish' }))).toBe(false)
  expect(isFooter(component())).toBe(false)
})

test('the first footer added cannot be deleted or duplicated', () => {
  const { editor, add } = fakeEditor()
  rules(editor)

  const one = footer()
  add(one)
  expect(one.props.removable).toBe(false)
  expect(one.props.copyable).toBe(false)
  expect(one.removed).toBe(false)
})

test('the footer keeps move and select-parent but loses the dead clone and delete buttons', () => {
  const { editor, add } = fakeEditor()
  rules(editor)

  const one = footer()
  add(one)
  expect(commandsOf(one)).toEqual([null, 'tlb-move'])

  // protecting twice must not strip anything else
  const sweep = rules(editor)
  sweep()
  expect(commandsOf(one)).toEqual([null, 'tlb-move'])
  expect(one.props.removable).toBe(false)
  expect(one.props.copyable).toBe(false)
})

test('a second footer is turned away and the reason is passed on', async () => {
  const onNotice = vi.fn()
  const { editor, add } = fakeEditor()
  rules(editor, { onNotice })

  const one = footer()
  add(one)
  const two = footer()
  add(two)

  // the removal waits for the drop to finish: undoing it mid-drop is overwritten by the sorter
  expect(two.removed).toBe(false)
  await settle()

  expect(two.removed).toBe(true)
  expect(one.removed).toBe(false)
  untouched(two)
  expect(onNotice).toHaveBeenCalledExactlyOnceWith(ONE_FOOTER_NOTICE)
})

test('two footers arriving together, as when the whole design is replaced, leave exactly one: the first', async () => {
  const onNotice = vi.fn()
  const { editor, canvas } = fakeEditor()
  const handlers: ((component: Component) => void)[] = []
  ;(editor as unknown as { on: (event: string, handler: (component: Component) => void) => void }).on = (_event, handler) => {
    handlers.push(handler)
  }
  rules(editor, { onNotice })

  // a replace puts the whole tree in place, then announces each component
  const first = footer()
  const second = footer()
  canvas.push(first, second)
  for (const item of [first, second]) handlers.forEach((handler) => handler(item))
  await settle()

  expect(first.removed).toBe(false)
  expect(second.removed).toBe(true)
  expect(first.props.removable).toBe(false)
  expect(onNotice).toHaveBeenCalledExactlyOnceWith(ONE_FOOTER_NOTICE)
})

test('a footer dropped above the protected one is the one turned away, not the footer that was there', async () => {
  const { editor, canvas, add } = fakeEditor()
  rules(editor)
  const kept = footer()
  add(kept)
  const dropped = footer()
  add(dropped)
  // it landed higher up in the email than the footer already there
  canvas.splice(canvas.indexOf(dropped), 1)
  canvas.unshift(dropped)
  await settle()
  expect(kept.removed).toBe(false)
  expect(dropped.removed).toBe(true)
})

test('blocks that are not footers are left alone', async () => {
  const onNotice = vi.fn()
  const { editor, add } = fakeEditor()
  rules(editor, { onNotice })

  const plain = component()
  add(plain)
  await settle()
  untouched(plain)
  expect(plain.removed).toBe(false)
  expect(onNotice).not.toHaveBeenCalled()
})

test('a loading design is never edited, and its footer is protected by the sweep afterwards', async () => {
  const onNotice = vi.fn()
  let isLoading = true
  const { editor, add } = fakeEditor()
  const sweep = rules(editor, { onNotice, isLoading: () => isLoading })

  const one = footer()
  const two = footer() // a stored design that somehow holds two keeps both: nothing is deleted on open
  add(one)
  add(two)
  await settle()
  expect(one.removed).toBe(false)
  expect(two.removed).toBe(false)
  expect(onNotice).not.toHaveBeenCalled()
  untouched(one)

  isLoading = false
  sweep()
  for (const item of [one, two]) {
    expect(item.props.removable).toBe(false)
    expect(item.props.copyable).toBe(false)
    expect(commandsOf(item)).toEqual([null, 'tlb-move'])
  }
})

test('the sweep protects a footer that arrived with a loaded design', () => {
  const one = footer()
  const { editor } = fakeEditor([one])
  rules(editor)()

  expect(one.props.removable).toBe(false)
  expect(one.props.copyable).toBe(false)
  expect(commandsOf(one)).toEqual([null, 'tlb-move'])
})

test('read-only and non-email channels add no rules of their own', async () => {
  for (const over of [{ readOnly: true }, { channel: 'E_RECEIPT' }]) {
    const onNotice = vi.fn()
    const { editor, add } = fakeEditor()
    const sweep = rules(editor, { ...over, onNotice })

    const one = footer()
    const two = footer()
    add(one)
    add(two)
    sweep()
    await settle()

    expect(two.removed, JSON.stringify(over)).toBe(false)
    untouched(one)
    expect(onNotice).not.toHaveBeenCalled()
  }
})

test('a picture block is registered with the newest image already in it', () => {
  const { editor, added } = mockEditor()
  const url = 'https://cdn.example.com/media/fall-hero.jpg'
  registerBlocks(editor, { channel: 'EMAIL', imageUrl: url })

  for (const block of CEP_BLOCKS) {
    const content = added.find((item) => item.id === block.id)?.props.content ?? ''
    expect(content, block.id).not.toContain(ASSET_IMAGE_TOKEN)
    if (needsImage(block)) expect(content, block.id).toContain(`src="${url}"`)
    else expect(content, block.id).toBe(block.mjml)
  }
})

test('a new image re-points only the blocks that carry a picture', () => {
  const contents = new Map<string, string>()
  const blocks = new Map(CEP_BLOCKS.map((block) => [block.id, { set: (_key: string, value: string) => contents.set(block.id, value) }]))
  const editor = { Blocks: { get: (id: string) => blocks.get(id) } } as unknown as Editor

  setBlockImage(editor, 'https://cdn.example.com/media/winter.png')
  expect([...contents.keys()].sort()).toEqual(['image', 'product-card'])
  for (const content of contents.values()) expect(content).toContain('src="https://cdn.example.com/media/winter.png"')
})

test('a block carrying no picture starts with an empty address, never with the token', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL', imageUrl: null })
  const content = added.find((item) => item.id === 'image')?.props.content ?? ''
  expect(content).not.toContain(ASSET_IMAGE_TOKEN)
  expect(content).toContain('src=""')
})

test('clearing the picture puts the picture blocks back to an empty address', () => {
  const contents = new Map<string, string>()
  const blocks = new Map(CEP_BLOCKS.map((block) => [block.id, { set: (_key: string, value: string) => contents.set(block.id, value) }]))
  const editor = { Blocks: { get: (id: string) => blocks.get(id) } } as unknown as Editor

  setBlockImage(editor, null)
  expect([...contents.values()].every((content) => content.includes('src=""'))).toBe(true)
})

test('both insertion paths hand over the same inset MJML, picture or no picture', () => {
  const { editor, added } = mockEditor()
  registerBlocks(editor, { channel: 'EMAIL' })

  for (const id of ['image', 'divider']) {
    const block = CEP_BLOCKS.find((item) => item.id === id)!
    // what a drag carries, and what a keyboard insert builds
    expect(added.find((item) => item.id === id)?.props.content, id).toContain(`padding="${COLUMN_PADDING}"`)
    expect(blockContent(block, null), id).toContain(`padding="${COLUMN_PADDING}"`)
    expect(blockContent(block, 'https://cdn.example.com/a.png'), id).toContain(`padding="${COLUMN_PADDING}"`)
  }
})

test('carrying a picture changes only the address, so the inset an existing column sees is untouched', () => {
  const image = CEP_BLOCKS.find((item) => item.id === 'image')!
  const withPicture = blockContent(image, 'https://cdn.example.com/a.png')
  expect(withPicture).toBe(image.mjml.replace(ASSET_IMAGE_TOKEN, 'https://cdn.example.com/a.png'))
})
