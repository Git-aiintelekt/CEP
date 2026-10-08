import { Megaphone, Route, type LucideIcon } from 'lucide-react'

/**
 * What a thing is, not what state it is in: the status tag's shape with an icon where the dot would be, never a dot.
 * Seasonal, loyalty, promotional and transactional have tokens (--color-cat-*) and join here once the data has the field.
 */
export type Category = 'journey' | 'campaign'

const CATEGORY: Record<Category, { label: string; icon: LucideIcon; colours: string }> = {
  journey: { label: 'Journey', icon: Route, colours: 'bg-cat-journey-bg text-cat-journey-text' },
  campaign: { label: 'Campaign', icon: Megaphone, colours: 'bg-cat-campaign-bg text-cat-campaign-text' },
}

export function CategoryTag({ category }: { category: Category }) {
  const { label, icon: Icon, colours } = CATEGORY[category]
  return (
    <span data-category={category} className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap ${colours}`}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {label}
    </span>
  )
}
