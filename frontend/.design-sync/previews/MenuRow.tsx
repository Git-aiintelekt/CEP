import { MenuRow, StatusBadge } from 'cep-frontend'

export const Menu = () => (
  <div style={{ width: 320 }} className="overflow-hidden rounded-md border border-line bg-surface-overlay shadow-menu">
    <MenuRow title="Spring Sale Newsletter" detail="Email · 12,480 contacts" trailing={<StatusBadge status="SCHEDULED" />} />
    <MenuRow title="Loyalty Points Reminder" detail="SMS · 3,215 contacts" selected trailing={<StatusBadge status="ACTIVE" />} />
    <MenuRow title="Win-Back Offer" detail="The sender domain is not verified yet." tone="warning" />
    <MenuRow title="Black Friday Teaser" detail="Delivery failed for this list." tone="error" />
    <MenuRow title="Holiday Hours Notice" detail="Archived campaigns can't be duplicated." disabled />
  </div>
)
