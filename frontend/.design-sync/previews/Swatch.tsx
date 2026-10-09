import { Swatch } from 'cep-frontend'

const item = { display: 'flex', alignItems: 'center', gap: 6 }

export const Shapes = () => (
  <div style={{ display: 'flex', gap: 20 }} className="text-xs text-ink-800">
    <span style={item}><Swatch color="var(--color-brand-600)" />Delivered</span>
    <span style={item}><Swatch color="var(--color-brand-700)" shape="line" />Opened</span>
    <span style={item}><Swatch color="var(--color-ink-800)" shape="dashed" />Last Month</span>
    <span style={item}><Swatch color="var(--color-brand-600)" hollow />Hidden Series</span>
  </div>
)
