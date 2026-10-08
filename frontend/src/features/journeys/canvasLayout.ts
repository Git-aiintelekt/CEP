/** Lays the editor tree out as React Flow nodes/edges: a vertical spine centred on x = 0, a Condition opening two
 * side-by-side branch spines that rejoin the trunk, a "+" node at every point a step can be inserted, and a
 * "Contact exits" marker at the end of each path. Positions are top-left corners.
 *
 * Read-only (a template's preview): the same cards and connectors, with no "+" points, so cards sit closer. */
import type { Edge, Node } from '@xyflow/react'

import { type EditorNode, type Path, forkKeys, forkLabels, isFork, isNodeConfigured } from './graphModel'
import { hasEmailPreview } from './nodeDefs'

/** the tag a card shows under its description: a starter's unconfigured steps "Needs Setup" */
export type CardTag = 'needs-setup' | null

export interface StepNodeData {
  node: EditorNode
  path: Path
  tag: CardTag
  [key: string]: unknown
}
export interface AddNodeData {
  path: Path
  index: number
  insideBranch: boolean
  [key: string]: unknown
}
export interface EntryNodeData {
  [key: string]: unknown
}
export interface EndNodeData {
  [key: string]: unknown
}

export type CanvasNode = Node<StepNodeData, 'step'> | Node<AddNodeData, 'add'> | Node<EntryNodeData, 'entry'> | Node<EndNodeData, 'end'>

// Given explicitly rather than measured: React Flow only shows a node once it knows a size for it, and jsdom (the
// test environment) never reports real layout, so every custom node gets its real width/height up front. The cards
// render at exactly these sizes (JourneyCanvas sizes them to fill the node).
export const CARD_WIDTH = 430
export const CARD_HEIGHT = 96
/** an Email card with a template chosen: its 58px preview box and a 12px gap under the text */
export const CARD_HEIGHT_PREVIEW = CARD_HEIGHT + 70
/** a card's tag line under its description: a 22px tag and a 6px gap */
export const CARD_TAG_HEIGHT = 28
const ADD_SIZE = 28
const END_SIZE = { width: 160, height: 20 }
/** the connector between a card and a "+" */
const GAP = 20
/** a Condition's card to its branches' first "+": room for the elbow and the YES / NO tag */
const FORK_GAP = 64
/** the extra drop where the two branches rejoin the trunk */
const REJOIN_GAP = 24
const END_GAP = 28
/** read-only: the connector between two cards, with no "+" on it */
const READ_GAP = 36
/** each branch's centre line, either side of the trunk: half a card plus half the 60px gutter between them */
const BRANCH_X = CARD_WIDTH / 2 + 30
const ENTRY_KEY = '__entry__'

function pathKey(path: Path): string {
  return path.map((step) => `${step.index}${step.branch ? `:${step.branch}` : ''}`).join('/')
}

interface Pending {
  id: string
}

interface Out {
  nodes: CanvasNode[]
  edges: Edge[]
}

interface Options {
  readOnly: boolean
  tagFor: (node: EditorNode) => CardTag
}

/** the editor's tags: every unconfigured step says so */
export function editorTag(node: EditorNode): CardTag {
  return isNodeConfigured(node) ? null : 'needs-setup'
}

function cardHeight(node: EditorNode, tag: CardTag): number {
  return (hasEmailPreview(node) ? CARD_HEIGHT_PREVIEW : CARD_HEIGHT) + (tag ? CARD_TAG_HEIGHT : 0)
}

function connect(out: Out, from: string, to: string, extra: Partial<Edge> = {}) {
  const base = `${from}->${to}`
  // two empty branches of one Condition both lead straight to the step after it
  const id = out.edges.some((edge) => edge.id === base) ? `${base}#${out.edges.length}` : base
  out.edges.push({ id, source: from, target: to, type: 'journey', ...extra })
}

function addEnd(id: string, from: string[], x: number, y: number, out: Out) {
  const endId = `end-${id}`
  out.nodes.push({ id: endId, type: 'end', position: { x: x - END_SIZE.width / 2, y }, ...END_SIZE, data: {}, draggable: false, selectable: false })
  for (const source of from) connect(out, source, endId, { data: { dashed: true } })
}

function placeStep(node: EditorNode, nodePath: Path, x: number, y: number, options: Options, out: Out): number {
  const tag = options.tagFor(node)
  const height = cardHeight(node, tag)
  out.nodes.push({ id: node.key, type: 'step', position: { x: x - CARD_WIDTH / 2, y }, width: CARD_WIDTH, height, data: { node, path: nodePath, tag }, draggable: false })
  return height
}

/** a fork's branches, side by side under it (two for a Condition or Goal, a Split's paths); returns their ends and the lowest bottom */
function layoutFork(node: EditorNode, containerPath: Path, i: number, x: number, y: number, options: Options, out: Out): { ends: Pending[]; bottom: number } {
  const keys = forkKeys(node)
  const labels = forkLabels(node)
  const branchY = y + FORK_GAP
  const ends: Pending[] = []
  let bottom = branchY
  keys.forEach((key, index) => {
    const branchPath: Path = [...containerPath, { index: i, branch: key }]
    const before = out.edges.length
    const result = layoutChain(node.branches?.[key] ?? [], branchPath, true, x + (index - (keys.length - 1) / 2) * 2 * BRANCH_X, branchY, [{ id: node.key }], options, out)
    const first = out.edges.slice(before).find((edge) => edge.source === node.key)
    if (first) first.label = labels[key] ?? key
    ends.push(...result.ends)
    bottom = Math.max(bottom, result.bottom)
  })
  return { ends, bottom: bottom + REJOIN_GAP }
}

function layoutChain(chain: EditorNode[], containerPath: Path, insideBranch: boolean, x: number, y: number, incoming: Pending[], options: Options, out: Out): { ends: Pending[]; bottom: number } {
  let pending = incoming
  let curY = y
  for (let i = 0; i <= chain.length; i += 1) {
    const afterExit = i > 0 && chain[i - 1].type === 'EXIT'
    if (i === chain.length && afterExit) break // nothing can follow an Exit step: no trailing "+" on this spine

    if (!options.readOnly) {
      const addId = `add-${pathKey(containerPath)}-${i}`
      out.nodes.push({ id: addId, type: 'add', position: { x: x - ADD_SIZE / 2, y: curY }, width: ADD_SIZE, height: ADD_SIZE, data: { path: containerPath, index: i, insideBranch }, draggable: false, selectable: false })
      for (const from of pending) connect(out, from.id, addId)
      pending = [{ id: addId }]
      curY += ADD_SIZE + GAP
    }
    if (i === chain.length) break

    const node = chain[i]
    const height = placeStep(node, [...containerPath, { index: i }], x, curY, options, out)
    for (const from of pending) connect(out, from.id, node.key)
    curY += height

    if (isFork(node)) {
      const fork = layoutFork(node, containerPath, i, x, curY, options, out)
      pending = fork.ends
      curY = fork.bottom
      continue
    }
    if (node.type === 'EXIT') {
      addEnd(node.key, [node.key], x, curY + END_GAP, out)
      curY += END_GAP + END_SIZE.height + GAP
      pending = []
      continue
    }
    curY += options.readOnly ? READ_GAP : GAP
    pending = [{ id: node.key }]
  }
  return { ends: pending, bottom: curY }
}

export function layoutCanvas(
  root: EditorNode[],
  { readOnly = false, tagFor = editorTag }: { readOnly?: boolean; tagFor?: (node: EditorNode) => CardTag } = {},
): { nodes: CanvasNode[]; edges: Edge[]; width: number; height: number } {
  const options: Options = { readOnly, tagFor }
  const out: Out = {
    nodes: [{ id: ENTRY_KEY, type: 'entry', position: { x: -CARD_WIDTH / 2, y: 0 }, width: CARD_WIDTH, height: CARD_HEIGHT, data: {}, draggable: false, selectable: false }],
    edges: [],
  }
  const { ends, bottom } = layoutChain(root, [], false, 0, CARD_HEIGHT + (readOnly ? READ_GAP : GAP), [{ id: ENTRY_KEY }], options, out)
  // the trunk's last "+" (read-only: its last step) leads to the end of the journey; a trunk ending in Exit already has its own marker
  if (!readOnly && ends.length === 1 && ends[0].id.startsWith('add-')) addEnd('root', [ends[0].id], 0, bottom - GAP + END_GAP, out)
  if (readOnly && ends.length > 0) addEnd('root', ends.map((end) => end.id), 0, bottom - READ_GAP + END_GAP, out)
  const left = Math.min(...out.nodes.map((node) => node.position.x))
  const right = Math.max(...out.nodes.map((node) => node.position.x + (node.width ?? 0)))
  const lowest = Math.max(...out.nodes.map((node) => node.position.y + (node.height ?? 0)))
  return { nodes: out.nodes, edges: out.edges, width: right - left, height: lowest }
}
