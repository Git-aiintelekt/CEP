import type { CatalogDataset, ReportDefinition } from './types'

/** the first columns of a dataset: up to four dimensions, then every measure with its first aggregate */
export function starterDefinition(dataset: CatalogDataset): ReportDefinition {
  const dimensions = dataset.fields.filter((f) => f.role === 'dimension' && f.type !== 'datetime').slice(0, 4)
  const measures = dataset.fields.filter((f) => f.role === 'measure' && f.aggregates.length > 0)
  const columns = [...dimensions.map((f) => ({ field: f.key })), ...measures.map((f) => ({ field: f.key, aggregate: f.aggregates[0] }))]
  const first = measures[0]
  return { columns, filters: { combinator: 'and', rules: [] }, orderBy: first ? [{ field: first.key, direction: 'desc' }] : [], limit: 500 }
}
