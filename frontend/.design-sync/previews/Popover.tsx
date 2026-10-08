import { MenuRow, Popover } from 'cep-frontend'

export const WithTitle = () => (
  <div style={{ width: 300 }}>
    <Popover label="Sort campaigns" title="Sort By" placement="none" width={280}>
      <MenuRow title="Last Updated" selected divider={false} />
      <MenuRow title="Name" divider={false} />
      <MenuRow title="Send Date" divider={false} />
    </Popover>
  </div>
)

export const Note = () => (
  <div style={{ width: 320 }}>
    <Popover label="About sender name" placement="none" width={300} className="px-3 py-2.5">
      <p className="text-helper leading-relaxed text-ink-800">The name recipients see in their inbox. Use your brand name so people recognise the email.</p>
    </Popover>
  </div>
)
