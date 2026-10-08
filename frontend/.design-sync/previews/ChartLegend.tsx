import { useState } from 'react'
import { ChartLegend } from 'cep-frontend'

const series = [
  { key: 'delivered', label: 'Delivered', values: [] },
  { key: 'opened', label: 'Opened', values: [], mark: 'line' as const },
  { key: 'clicked', label: 'Clicked', values: [], mark: 'line' as const },
]

function Legend({ initiallyHidden = [] as string[], withReference = false }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set(initiallyHidden))
  const toggle = (key: string) => setHidden((h) => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n })
  return (
    <ChartLegend
      series={series}
      hidden={hidden}
      onToggle={toggle}
      reference={withReference ? { key: 'last', label: 'Last Month', values: [] } : undefined}
    />
  )
}

export const AllShown = () => <Legend />
export const OneHidden = () => <Legend initiallyHidden={['clicked']} />
export const WithReference = () => <Legend withReference />
