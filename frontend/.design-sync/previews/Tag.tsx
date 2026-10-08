import { Tag } from 'cep-frontend'

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: 420 }}>
    <Tag>Email</Tag>
    <Tag tone="success">Verified</Tag>
    <Tag tone="warning">Needs Review</Tag>
    <Tag tone="error">Bounced</Tag>
    <Tag tone="brand">{'{{first_name}}'}</Tag>
  </div>
)
