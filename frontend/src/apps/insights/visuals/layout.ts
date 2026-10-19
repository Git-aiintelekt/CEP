/** The geometry the report visuals need: a squarified treemap, and a waterfall's floating steps. */

export interface Box { x: number; y: number; w: number; h: number }

/** squarified treemap (Bruls, Huizing, van Wijk): the items laid in rows that keep the boxes near square, largest first */
export function squarify<T extends { value: number }>(items: T[], box: Box): (T & Box)[] {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (!total || box.w <= 0 || box.h <= 0) return []
  const scale = (box.w * box.h) / total
  const queue = [...items].sort((a, b) => b.value - a.value).map((item) => ({ item, area: item.value * scale }))
  const out: (T & Box)[] = []
  let rest = { ...box }
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((s, r) => s + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }
  while (queue.length) {
    const side = Math.min(rest.w, rest.h)
    const row = [queue.shift()!]
    while (queue.length && worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift()!)
    const sum = row.reduce((s, r) => s + r.area, 0)
    if (rest.w >= rest.h) {                                 // a column on the left
      const w = sum / rest.h
      let y = rest.y
      for (const r of row) { const h = r.area / w; out.push({ ...r.item, x: rest.x, y, w, h }); y += h }
      rest = { x: rest.x + w, y: rest.y, w: rest.w - w, h: rest.h }
    } else {                                                // a row along the top
      const h = sum / rest.w
      let x = rest.x
      for (const r of row) { const w = r.area / h; out.push({ ...r.item, x, y: rest.y, w, h }); x += w }
      rest = { x: rest.x, y: rest.y + h, w: rest.w, h: rest.h - h }
    }
  }
  return out
}

export interface Step { start: number; end: number; kind: 'up' | 'down' | 'total' }

/** each step floats from the running total before it to the one after; the last bar is the whole */
export function waterfallSteps(values: number[]): Step[] {
  let running = 0
  const steps: Step[] = values.map((value) => {
    const start = running
    running += value
    return { start, end: running, kind: value >= 0 ? 'up' : 'down' }
  })
  return [...steps, { start: 0, end: running, kind: 'total' }]
}
