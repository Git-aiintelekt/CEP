/**
 * The thin seam between GrapesJS and the layers tree.
 *
 * Hiding on the canvas is a view state: it paints a data attribute on the rendered element inside the frame and
 * never touches the component model, so the MJML, the compiled HTML and the project JSON are untouched by it.
 * Hiding on phones is the opposite — a css-class on the component, which is read here and ships with the email.
 */
import type { Component, Editor } from 'grapesjs'

import { isHiddenOnPhones } from '../blocks/register'
import { HIDDEN_ATTRIBUTE } from './hidden'
import { layerNameFor } from './layerNames'
import type { LayerNode } from './types'

/** The tree starts at the email body: the wrapper, mjml and mj-head are template plumbing, not content. */
export function layerRoot(editor: Editor): Component | undefined {
  return editor.getWrapper()?.findType('mj-body')[0]
}

function childrenOf(editor: Editor, component: Component): Component[] {
  return editor.Layers.getComponents(component)
}

export function buildNodes(editor: Editor, hidden: ReadonlySet<string>): LayerNode[] {
  const root = layerRoot(editor)
  if (!root) return []
  const selected = editor.getSelected()

  const toNode = (component: Component, index: number, siblings: Component[]): LayerNode => {
    const kind = String(component.get('type') ?? component.get('tagName') ?? '')
    const id = String(component.getId())
    const kids = childrenOf(editor, component)
    const draggable = component.get('draggable') !== false
    return {
      id,
      kind,
      name: layerNameFor(kind, component.get('custom-name'), component.getAttributes()),
      children: kids.map((child, childIndex) => toNode(child, childIndex, kids)),
      open: editor.Layers.isOpen(component),
      visible: !hidden.has(id),
      hiddenOnPhones: isHiddenOnPhones(component),
      selected: component === selected,
      removable: component.get('removable') !== false,
      draggable,
      // siblings only: the panel never changes a block's parent, so MJML nesting cannot be broken; a locked block
      // neither moves nor is moved past
      canMoveUp: index > 0 && draggable && siblings[index - 1].get('draggable') !== false,
      canMoveDown: index < siblings.length - 1 && draggable && siblings[index + 1].get('draggable') !== false,
    }
  }

  const top = childrenOf(editor, root)
  return top.map((child, index) => toNode(child, index, top))
}

/** Every component the tree can show, which is what a hidden id has to still match. */
export function layerIds(editor: Editor): string[] {
  const root = layerRoot(editor)
  if (!root) return []
  const ids: string[] = []
  const walk = (component: Component) => {
    for (const child of childrenOf(editor, component)) {
      ids.push(String(child.getId()))
      walk(child)
    }
  }
  walk(root)
  return ids
}

export function findLayer(editor: Editor, id: string): Component | undefined {
  const root = layerRoot(editor)
  if (!root) return undefined
  let found: Component | undefined
  const walk = (component: Component) => {
    for (const child of childrenOf(editor, component)) {
      if (found) return
      if (String(child.getId()) === id) {
        found = child
        return
      }
      walk(child)
    }
  }
  walk(root)
  return found
}

/** Paints the frame's DOM only. Re-run whenever GrapesJS re-renders, since a re-render drops the attribute. */
export function paintHidden(editor: Editor, hidden: ReadonlySet<string>): void {
  const root = layerRoot(editor)
  if (!root) return
  const walk = (component: Component) => {
    for (const child of childrenOf(editor, component)) {
      const element = child.getEl()
      if (element) {
        if (hidden.has(String(child.getId()))) element.setAttribute(HIDDEN_ATTRIBUTE, '')
        else element.removeAttribute(HIDDEN_ATTRIBUTE)
      }
      walk(child)
    }
  }
  walk(root)
}

/** A block picked on the canvas can sit inside closed branches, so its ancestors are opened to show its row. */
export function revealSelected(editor: Editor): void {
  const root = layerRoot(editor)
  const selected = editor.getSelected()
  if (!root || !selected) return
  for (let parent = selected.parent(); parent && parent !== root; parent = parent.parent()) {
    if (!editor.Layers.isOpen(parent)) editor.Layers.setOpen(parent, true)
  }
}

export function selectLayer(editor: Editor, id: string): void {
  const component = findLayer(editor, id)
  if (!component) return
  editor.select(component)
  editor.Canvas.scrollTo(component, { behavior: 'smooth' })
}

export function toggleOpen(editor: Editor, id: string): void {
  const component = findLayer(editor, id)
  if (component) editor.Layers.setOpen(component, !editor.Layers.isOpen(component))
}

/** Stored as custom-name in the project JSON, so it survives a save and reload and stays out of the MJML. */
export function renameLayer(editor: Editor, id: string, name: string): void {
  const component = findLayer(editor, id)
  if (component) editor.Layers.setName(component, name.trim())
}

export function removeLayer(editor: Editor, id: string): void {
  const component = findLayer(editor, id)
  if (component && component.get('removable') !== false) component.remove()
}

/**
 * Reorders among siblings only. GrapesJS detaches the component before inserting it, so every index after the
 * source shifts down by one: moving down one step is `at: index + 2`, not `index + 1`.
 */
export function moveLayer(editor: Editor, id: string, direction: 'up' | 'down'): void {
  const component = findLayer(editor, id)
  const parent = component?.parent()
  if (!component || !parent) return

  const siblings = childrenOf(editor, parent)
  const index = siblings.indexOf(component)
  if (index === -1) return
  if (direction === 'up' ? index === 0 : index === siblings.length - 1) return
  // the panel already checks this; any other caller gets the same lock
  if (component.get('draggable') === false) return
  if (siblings[direction === 'up' ? index - 1 : index + 1].get('draggable') === false) return

  component.move(parent, { at: direction === 'up' ? index - 1 : index + 2 })
  editor.select(component)
  editor.Canvas.scrollTo(component, { behavior: 'smooth' })
}

export function highlightLayer(editor: Editor, id: string | null): void {
  const root = layerRoot(editor)
  if (!root) return
  const walk = (component: Component) => {
    for (const child of childrenOf(editor, component)) {
      const wanted = id !== null && String(child.getId()) === id
      if (editor.Layers.getLayerData(child).hovered !== wanted) editor.Layers.setLayerData(child, { hovered: wanted })
      walk(child)
    }
  }
  walk(root)
}

/** layer:component covers add, remove, move, rename and selection; layer:root covers a load. One frame apart. */
export function subscribeLayers(editor: Editor, onChange: () => void): () => void {
  let frame = 0
  const schedule = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      onChange()
    })
  }
  editor.on('layer:component', schedule)
  editor.on('layer:root', schedule)
  return () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    editor.off('layer:component', schedule)
    editor.off('layer:root', schedule)
  }
}
