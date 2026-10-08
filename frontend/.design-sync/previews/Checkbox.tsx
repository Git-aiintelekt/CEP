import { Checkbox } from 'cep-frontend'

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Checkbox label="Send a test email first" />
    <Checkbox label="Track link clicks" defaultChecked />
    <Checkbox label="Include unsubscribed contacts" disabled />
    <Checkbox label="Use the workspace sender" disabled defaultChecked />
  </div>
)
