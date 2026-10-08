import { TruncatedText } from 'cep-frontend'

export const Cut = () => (
  <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8 }} className="text-sm text-ink-900">
    <TruncatedText text="Spring Sale Newsletter" />
    <TruncatedText text="Quarterly Loyalty Programme Update for Gold and Platinum Members" />
  </div>
)
