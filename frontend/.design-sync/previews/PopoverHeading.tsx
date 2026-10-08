import { PopoverHeading } from 'cep-frontend'

export const Heading = () => (
  <div style={{ width: 280 }} className="overflow-hidden rounded-md border border-line bg-surface-overlay">
    <PopoverHeading end={<span className="text-xs text-link">Clear</span>}>Filter By Status</PopoverHeading>
    <div className="px-3 py-2.5 text-helper text-ink-800">Draft, Scheduled, Active</div>
  </div>
)
