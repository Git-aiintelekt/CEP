import { expect, test } from 'vitest'

import { insertTarget, type InsertNode } from './insertTarget'

const node = (type: string, ...children: InsertNode[]): InsertNode => ({ type, children })
const text = () => node('mj-text')

/** mj-body > [section0 > [column0 > [text, text], column1 > [text]], section1 > [column0 > [text]]] */
const body = () =>
  node(
    'mj-body',
    node('mj-section', node('mj-column', text(), text()), node('mj-column', text())),
    node('mj-section', node('mj-column', text())),
  )

test('a section goes after the section holding the selection', () => {
  const tree = body()
  expect(insertTarget(tree, [0, 0, 1], 'section')).toEqual({ parent: tree, index: 1, fellBack: false })
  expect(insertTarget(tree, [1, 0], 'section')).toEqual({ parent: tree, index: 2, fellBack: false })
})

test('a section with nothing selected goes to the end of the body', () => {
  const tree = body()
  expect(insertTarget(tree, null, 'section')).toEqual({ parent: tree, index: 2, fellBack: false })
})

test('a column-level block appends into the selected column', () => {
  const tree = body()
  const column = tree.children[0].children[1]
  expect(insertTarget(tree, [0, 1], 'column')).toEqual({ parent: column, index: 1, fellBack: false })
})

test('a column-level block on a selected section uses that section’s last column', () => {
  const tree = body()
  const lastColumn = tree.children[0].children[1]
  expect(insertTarget(tree, [0], 'column')).toEqual({ parent: lastColumn, index: 1, fellBack: false })
})

test('a column-level block goes straight after the selected block in its column', () => {
  const tree = body()
  const column = tree.children[0].children[0]
  expect(insertTarget(tree, [0, 0, 0], 'column')).toEqual({ parent: column, index: 1, fellBack: false })
  expect(insertTarget(tree, [0, 0, 1], 'column')).toEqual({ parent: column, index: 2, fellBack: false })
})

test('a column-level block with nothing selected falls back to the last column of the last section', () => {
  const tree = body()
  const lastColumn = tree.children[1].children[0]
  expect(insertTarget(tree, null, 'column')).toEqual({ parent: lastColumn, index: 1, fellBack: true })
})

test('the fallback is reported so the reader can be told where it went', () => {
  expect(insertTarget(body(), null, 'column')?.fellBack).toBe(true)
  expect(insertTarget(body(), [0, 0], 'column')?.fellBack).toBe(false)
})

test('a column-level block with nowhere to go returns nothing', () => {
  expect(insertTarget(node('mj-body'), null, 'column')).toBeNull()
  expect(insertTarget(node('mj-body', node('mj-section')), null, 'column')).toBeNull()
})

test('a section still lands in an empty body', () => {
  const tree = node('mj-body')
  expect(insertTarget(tree, null, 'section')).toEqual({ parent: tree, index: 0, fellBack: false })
})

test('a path that runs off the tree is treated as no selection', () => {
  const tree = body()
  expect(insertTarget(tree, [9], 'section')).toEqual({ parent: tree, index: 2, fellBack: true })
})
