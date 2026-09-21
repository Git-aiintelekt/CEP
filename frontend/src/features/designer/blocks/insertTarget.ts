/**
 * Where a keyboard insert lands, as pure arithmetic on the component tree: no GrapesJS, so the six rules
 * below are testable. The caller walks the real tree into this shape and applies the answer.
 */
import type { DropLevel } from './dropLevel'

export interface InsertNode {
  type: string
  children: InsertNode[]
}

export interface InsertTarget {
  parent: InsertNode
  index: number
  /** nothing usable was selected, so the insert went to the end of the design */
  fellBack: boolean
}

/** `path` is the selected component's child indices from mj-body down, or null when nothing is selected. */
export function insertTarget(body: InsertNode, path: number[] | null, level: DropLevel): InsertTarget | null {
  const chain = walk(body, path)

  if (level === 'section') {
    const depth = chain.findIndex((node) => node.type === 'mj-section')
    if (depth === -1) return { parent: body, index: body.children.length, fellBack: path !== null && path.length > 0 }
    return { parent: body, index: (path as number[])[0] + 1, fellBack: false }
  }

  const last = chain.at(-1)
  if (last?.type === 'mj-column') return { parent: last, index: last.children.length, fellBack: false }

  if (last?.type === 'mj-section') {
    const column = lastOfType(last, 'mj-column')
    if (column) return { parent: column, index: column.children.length, fellBack: false }
  }

  // a block inside a column goes straight after it
  const parent = chain.at(-2)
  if (last && parent?.type === 'mj-column') return { parent, index: parent.children.indexOf(last) + 1, fellBack: false }

  const section = lastOfType(body, 'mj-section')
  const column = section && lastOfType(section, 'mj-column')
  return column ? { parent: column, index: column.children.length, fellBack: true } : null
}

/** The selected node and its ancestors below mj-body, nearest last. Empty when nothing is selected. */
function walk(body: InsertNode, path: number[] | null): InsertNode[] {
  const chain: InsertNode[] = []
  let node = body
  for (const index of path ?? []) {
    const next = node.children[index]
    if (!next) break
    chain.push(next)
    node = next
  }
  return chain
}

function lastOfType(node: InsertNode, type: string): InsertNode | undefined {
  return [...node.children].reverse().find((child) => child.type === type)
}
