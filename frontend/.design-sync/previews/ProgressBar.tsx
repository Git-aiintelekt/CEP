import { ProgressBar } from 'cep-frontend'

const steps = [
  { value: 12, label: 'Uploading contacts', note: '1,498 of 12,480' },
  { value: 58, label: 'Sending campaign', note: '58%' },
  { value: 100, label: 'Import complete', note: 'Done' },
]

export const Values = () => (
  <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
    {steps.map((s) => (
      <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="flex justify-between text-xs text-ink-800"><span>{s.label}</span><span className="cep-num">{s.note}</span></div>
        <ProgressBar value={s.value} label={s.label} />
      </div>
    ))}
  </div>
)
