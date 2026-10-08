import { IconButton, PencilIcon, CopyIcon, Trash2Icon, XIcon, EllipsisVerticalIcon, FilterIcon } from 'cep-frontend'

const row = { display: 'flex', alignItems: 'center', gap: 8 }

export const Variants = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={row}>
      <IconButton label="Edit Campaign" icon={PencilIcon} />
      <IconButton label="Duplicate" icon={CopyIcon} />
      <IconButton label="More Actions" icon={EllipsisVerticalIcon} />
      <IconButton label="Close" icon={XIcon} size="sm" />
    </div>
    <div style={row}>
      <IconButton label="Filter" icon={FilterIcon} variant="outline" />
      <IconButton label="Filter (on)" icon={FilterIcon} variant="outline" pressed />
      <IconButton label="Delete" icon={Trash2Icon} variant="outline" disabled />
    </div>
  </div>
)

export const OnBrand = () => (
  <div style={{ ...row, padding: 12, borderRadius: 6 }} className="bg-band">
    <IconButton label="Edit" icon={PencilIcon} variant="onBrand" />
    <IconButton label="Close" icon={XIcon} variant="onBrand" />
  </div>
)
