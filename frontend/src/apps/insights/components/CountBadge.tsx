/** The count beside an Insights list page's title, as on Reports and Journeys. */
export function CountBadge({ count }: { count: number | undefined }) {
  if (count === undefined) return null
  return <span className="cep-num inline-flex h-[22px] items-center rounded-sm bg-fill-subtle px-2 font-body text-xs font-semibold text-ink-800">{count.toLocaleString()}</span>
}
