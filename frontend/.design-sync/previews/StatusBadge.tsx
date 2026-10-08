import { StatusBadge } from 'cep-frontend'

const row = { display: 'flex', flexWrap: 'wrap' as const, gap: 8, width: 420 }

export const Lifecycle = () => (
  <div style={row}>
    <StatusBadge status="DRAFT" />
    <StatusBadge status="TEST_PUBLISHED" />
    <StatusBadge status="PRODUCTION_PUBLISHED" />
    <StatusBadge status="SCHEDULED" />
  </div>
)

export const Live = () => (
  <div style={row}>
    <StatusBadge status="ACTIVE" />
    <StatusBadge status="SENDING" />
    <StatusBadge status="PREPARING" />
  </div>
)

export const Outcomes = () => (
  <div style={row}>
    <StatusBadge status="COMPLETED" />
    <StatusBadge status="PAUSED" />
    <StatusBadge status="FAILED" />
    <StatusBadge status="ARCHIVED" />
  </div>
)
