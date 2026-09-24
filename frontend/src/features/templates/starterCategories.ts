/** How the starter gallery groups its cards. Pure, so it is tested without the page. */
import type { TemplateStarter } from '@/lib/types'

export const ALL_CATEGORIES = 'All'

/** All first, then the categories in the order the server lists them, each with how many starters it holds. */
export function categoriesOf(starters: TemplateStarter[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const starter of starters) counts.set(starter.category, (counts.get(starter.category) ?? 0) + 1)
  return [{ name: ALL_CATEGORIES, count: starters.length }, ...[...counts].map(([name, count]) => ({ name, count }))]
}

export const starterCount = (count: number) => `${count} ${count === 1 ? 'starter' : 'starters'}`
