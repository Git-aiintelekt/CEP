/**
 * The canvas's own tree model (a vertical chain, with a Condition opening exactly two branch chains — no nesting),
 * and its conversion to and from the wire graph `PUT /journeys/{id}/versions/{n}/graph/` expects (apps/journeys/graph.py).
 *
 * The chain is the editor's source of truth; positions and connections are derived from it on save, and reconstructed
 * on load by walking the wire graph's edges (every graph here was produced by `toWireGraph`, so the shape is known:
 * one spine, a Condition's two branches reconverging on the node that has more than one incoming edge, or ending in
 * their own Exit step).
 */
import type { ConditionRule, JourneyGraph, JourneyGraphConnection, JourneyGraphNode, JourneyNodeType } from '@/lib/types'

import { isRuleComplete } from './conditions/conditionModel'

export interface EditorNode {
  key: string
  type: JourneyNodeType
  config: Record<string, unknown>
  /** only on a CONDITION node */
  branches?: { YES: EditorNode[]; NO: EditorNode[] }
}

let counter = 0
export function newKey(type: string): string {
  counter += 1
  return `${type.toLowerCase()}-${Date.now().toString(36)}-${counter}`
}

const X_STEP = 280
const Y_STEP = 150
const START_KEY = 'start'

interface Pending {
  key: string
  branch: string | null
}

function buildChain(chain: EditorNode[], incoming: Pending[], x: number, y: number, nodes: JourneyGraphNode[], connections: JourneyGraphConnection[]): { ends: Pending[]; maxY: number } {
  let pending = incoming
  let curY = y
  let maxY = y
  for (const node of chain) {
    nodes.push({ key: node.key, type: node.type, config: node.config, position: { x, y: curY } })
    for (const inc of pending) connections.push({ from: inc.key, to: node.key, branch_key: inc.branch, label: null })
    maxY = Math.max(maxY, curY)
    curY += Y_STEP
    if (node.type === 'CONDITION') {
      const yes = buildChain(node.branches?.YES ?? [], [{ key: node.key, branch: 'YES' }], x - X_STEP, curY, nodes, connections)
      const no = buildChain(node.branches?.NO ?? [], [{ key: node.key, branch: 'NO' }], x + X_STEP, curY, nodes, connections)
      pending = [...yes.ends, ...no.ends]
      curY = Math.max(yes.maxY, no.maxY) + Y_STEP
      maxY = curY
      continue
    }
    pending = node.type === 'EXIT' ? [] : [{ key: node.key, branch: null }]
  }
  return { ends: pending, maxY }
}

/** The editor tree -> the graph the backend validates and stores. */
export function toWireGraph(root: EditorNode[], entryRules: JourneyGraph['entry_rules']): JourneyGraph {
  const nodes: JourneyGraphNode[] = [{ key: START_KEY, type: 'START', config: {}, position: { x: 0, y: 0 } }]
  const connections: JourneyGraphConnection[] = []
  buildChain(root, [{ key: START_KEY, branch: null }], 0, Y_STEP, nodes, connections)
  return { entry_rules: entryRules, nodes, connections }
}

type EdgeIndex = Map<string, JourneyGraphConnection[]>
type NodeIndex = Map<string, JourneyGraphNode>
type IncomingCount = Map<string, number>

function outs(key: string, byFrom: EdgeIndex): JourneyGraphConnection[] {
  return byFrom.get(key) ?? []
}

/** Follows a branch's single-outgoing-edge chain until it hits a shared node (more than one incoming edge — where
 * the branches rejoin the trunk) or its own Exit step. CONDITION cannot nest inside a branch, so every node found
 * here is a plain step. */
function traceBranch(startKey: string, byFrom: EdgeIndex, byKey: NodeIndex, incomingCount: IncomingCount): { nodes: EditorNode[]; rejoin: string | null } {
  const out: EditorNode[] = []
  let key: string | undefined = startKey
  while (key) {
    const node = byKey.get(key)
    if (!node) break
    if ((incomingCount.get(key) ?? 0) > 1) return { nodes: out, rejoin: key }
    if (node.type === 'EXIT') {
      out.push({ key: node.key, type: node.type, config: node.config })
      return { nodes: out, rejoin: null }
    }
    out.push({ key: node.key, type: node.type, config: node.config })
    key = outs(key, byFrom)[0]?.to
  }
  return { nodes: out, rejoin: null }
}

/** The chain from `key` itself (inclusive) onward, following the trunk and expanding any Condition it meets. */
function walkInclusive(key: string, byFrom: EdgeIndex, byKey: NodeIndex, incomingCount: IncomingCount): EditorNode[] {
  const node = byKey.get(key)
  if (!node) return []
  if (node.type === 'EXIT') return [{ key: node.key, type: node.type, config: node.config }]
  if (node.type === 'CONDITION') {
    const yesOut = outs(node.key, byFrom).find((edge) => edge.branch_key === 'YES')
    const noOut = outs(node.key, byFrom).find((edge) => edge.branch_key === 'NO')
    const yes = yesOut ? traceBranch(yesOut.to, byFrom, byKey, incomingCount) : { nodes: [], rejoin: null }
    const no = noOut ? traceBranch(noOut.to, byFrom, byKey, incomingCount) : { nodes: [], rejoin: null }
    const parsed: EditorNode = { key: node.key, type: 'CONDITION', config: node.config, branches: { YES: yes.nodes, NO: no.nodes } }
    const rejoin = yes.rejoin ?? no.rejoin
    return [parsed, ...(rejoin ? walkInclusive(rejoin, byFrom, byKey, incomingCount) : [])]
  }
  return [{ key: node.key, type: node.type, config: node.config }, ...walk(node.key, byFrom, byKey, incomingCount)]
}

/** The chain after `key` (exclusive), i.e. what `key`'s single outgoing edge leads to. */
function walk(key: string, byFrom: EdgeIndex, byKey: NodeIndex, incomingCount: IncomingCount): EditorNode[] {
  const edge = outs(key, byFrom)[0]
  return edge ? walkInclusive(edge.to, byFrom, byKey, incomingCount) : []
}

/** The wire graph -> the editor tree (the part after Start). */
export function fromWireGraph(graph: JourneyGraph): EditorNode[] {
  const byKey: NodeIndex = new Map(graph.nodes.map((node) => [node.key, node]))
  const byFrom: EdgeIndex = new Map()
  const incomingCount: IncomingCount = new Map()
  for (const edge of graph.connections) {
    byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge])
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
  }
  const start = graph.nodes.find((node) => node.type === 'START')
  if (!start) return []
  return walk(start.key, byFrom, byKey, incomingCount)
}

/** The steps a Condition can name: every message step, and every other Condition. */
export function conditionStepOptions(root: EditorNode[], exceptKey: string, describe: (node: EditorNode) => string): { key: string; label: string; type: 'EMAIL' | 'SMS' | 'MMS' | 'CONDITION' }[] {
  return flatten(root)
    .filter((node) => node.key !== exceptKey && (node.type === 'EMAIL' || node.type === 'SMS' || node.type === 'MMS' || node.type === 'CONDITION'))
    .map((node) => ({ key: node.key, label: describe(node), type: node.type as 'EMAIL' | 'SMS' | 'MMS' | 'CONDITION' }))
}

/** Flattens the tree to a plain list, for counting / validity checks. */
export function flatten(chain: EditorNode[]): EditorNode[] {
  return chain.flatMap((node) => (node.branches ? [node, ...flatten(node.branches.YES), ...flatten(node.branches.NO)] : [node]))
}

/** What each node type needs configured before the journey is ready for Test Publish. */
export function isNodeConfigured(node: EditorNode): boolean {
  const config = node.config ?? {}
  switch (node.type) {
    case 'WAIT':
      return config.duration !== undefined && config.duration !== null && config.duration !== ''
    case 'CONDITION':
      if (config.rule && typeof config.rule === 'object') return isRuleComplete(config.rule as ConditionRule, undefined, false)
      return Boolean(config.check)
    case 'EMAIL':
    case 'SMS':
    case 'MMS':
      return Boolean(config.template_id)
    case 'COUPON_ISSUE':
      return Boolean(config.coupon_id)
    case 'LOYALTY_CHANGE':
      return Boolean(config.tier_id)
    case 'SEGMENT_UPDATE':
      return Boolean(config.segment_id) && Boolean(config.action)
    case 'EXIT':
    case 'SPLIT':
    case 'START':
    default:
      return true
  }
}

export interface Validity {
  ready: boolean
  unconfigured: number
}

export function checkValidity(root: EditorNode[]): Validity {
  const all = flatten(root)
  const unconfigured = all.filter((node) => !isNodeConfigured(node)).length
  return { ready: all.length > 0 && unconfigured === 0, unconfigured }
}

/** Replaces the node at `path` (a sequence of indices through root / branches) with the result of `update`. */
export type Path = { index: number; branch?: 'YES' | 'NO' }[]

function cloneAt(chain: EditorNode[], path: Path, mutate: (chain: EditorNode[]) => EditorNode[]): EditorNode[] {
  if (path.length === 0) return mutate(chain)
  const [head, ...rest] = path
  return chain.map((node, index) => {
    if (index !== head.index) return node
    if (!head.branch) return node
    const branches = node.branches ?? { YES: [], NO: [] }
    return { ...node, branches: { ...branches, [head.branch]: cloneAt(branches[head.branch], rest, mutate) } }
  })
}

export function insertAt(root: EditorNode[], path: Path, atIndex: number, node: EditorNode): EditorNode[] {
  return cloneAt(root, path, (chain) => [...chain.slice(0, atIndex), node, ...chain.slice(atIndex)])
}

export function updateAt(root: EditorNode[], path: Path, update: Partial<EditorNode>): EditorNode[] {
  if (path.length === 0) return root
  const parentPath = path.slice(0, -1)
  const { index } = path[path.length - 1]
  return cloneAt(root, parentPath, (chain) => chain.map((node, i) => (i === index ? { ...node, ...update } : node)))
}

/** A copy of a step (and, for a Condition, of both its branches) with fresh keys, for Duplicate. */
export function cloneWithNewKeys(node: EditorNode): EditorNode {
  return {
    key: newKey(node.type),
    type: node.type,
    config: { ...node.config },
    ...(node.branches ? { branches: { YES: node.branches.YES.map(cloneWithNewKeys), NO: node.branches.NO.map(cloneWithNewKeys) } } : {}),
  }
}

export function removeAt(root: EditorNode[], path: Path): EditorNode[] {
  if (path.length === 0) return root
  const parentPath = path.slice(0, -1)
  const { index } = path[path.length - 1]
  return cloneAt(root, parentPath, (chain) => chain.filter((_node, i) => i !== index))
}
