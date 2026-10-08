import { Button, PageHeader } from 'cep-frontend'

export const WithActions = () => (
  <div style={{ width: 720 }}>
    <PageHeader
      title="Campaigns"
      description="Plan, test and send email and SMS campaigns to your contact lists."
      actions={<Button variant="primary">New Campaign</Button>}
    />
  </div>
)

export const TitleOnly = () => (
  <div style={{ width: 720 }}>
    <PageHeader title="Contact Lists" />
  </div>
)
