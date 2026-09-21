import { expect, test } from 'vitest'

import { CLEAN, applyDirty, type DirtyEvent, type DirtyState } from './dirtyState'

/** Replays a run of events the way EmailDesigner does, collecting what onDirtyChange would have been told. */
function replay(events: DirtyEvent[], from: DirtyState = CLEAN) {
  let state = from
  const reported: boolean[] = []
  for (const event of events) {
    const next = applyDirty(state, event)
    state = next.state
    if (next.notify) reported.push(state.edited)
  }
  return { state, reported }
}

const edit = (loading = false): DirtyEvent => ({ kind: 'edit', loading })
const settle: DirtyEvent = { kind: 'settle' }

test('opening a design leaves it clean, and says nothing', () => {
  const { state, reported } = replay([{ kind: 'set', edited: false }, settle])
  expect(state.edited).toBe(false)
  expect(reported).toEqual([])
})

test('an edit makes it dirty and reports once', () => {
  const { state, reported } = replay([edit()])
  expect(state.edited).toBe(true)
  expect(reported).toEqual([true])
})

test('saving clears it, and editing again makes it dirty again', () => {
  const { state, reported } = replay([edit(), settle, edit()])
  expect(state.edited).toBe(true)
  expect(reported).toEqual([true, false, true])
})

test('changes while a design is loading are not the reader’s doing', () => {
  const { state, reported } = replay([edit(true), edit(true)])
  expect(state.edited).toBe(false)
  expect(reported).toEqual([])
})

test('a load in the middle of unsaved work settles it, and later loading events are still ignored', () => {
  const { state, reported } = replay([edit(), settle, edit(true)])
  expect(state.edited).toBe(false)
  expect(reported).toEqual([true, false])
})

test('onDirtyChange is only called when the answer changes', () => {
  const { reported } = replay([edit(), edit(), edit(), settle, settle, edit()])
  expect(reported).toEqual([true, false, true])
})

test('a repaired design opens dirty, so it gets saved again', () => {
  const { state, reported } = replay([{ kind: 'set', edited: true }])
  expect(state.edited).toBe(true)
  expect(reported).toEqual([true])
})

test('settling a design that was never dirty says nothing', () => {
  expect(applyDirty(CLEAN, settle).notify).toBe(false)
})

test('the state is replaced, never mutated', () => {
  const start: DirtyState = { ...CLEAN }
  applyDirty(start, edit())
  expect(start).toEqual(CLEAN)
})
