# CEP design conventions (read first)

CEP is a customer engagement platform for email/SMS campaigns. Every component is on `window.CEP`; style everything else with **Tailwind utility classes built on CEP tokens**. Never use raw hex, inline colours or Tailwind palette classes (`bg-blue-600`, `text-gray-500`): they bypass the tokens and break dark mode.

## Setup
- Link `styles.css` once. It carries the tokens, IBM Plex Sans/Mono and every component style. No theme provider is needed.
- Wrap the app in `<CEP.ToastProvider>` if anything calls `CEP.useToast()`.
- Dark mode: set `data-theme="dark"` on `<html>` (or any panel). Tokens switch by themselves, so use only token classes.
- Icons: pass the components to icon props (`iconStart`, `icon`), e.g. `CEP.PlusIcon`, `CEP.SearchIcon`, `CEP.MailIcon`, `CEP.XIcon`, `CEP.ChevronDownIcon`, `CEP.InboxIcon`, `CEP.SettingsIcon` (lucide icons with an `Icon` suffix).

## Look and feel
- Pages sit on `bg-canvas`; cards are `bg-surface` with a 1px `border border-line` hairline, `rounded-md` (max 8px), flat (no shadows except menus `shadow-menu`, drawers `shadow-drawer`).
- **Blue 600 is the only action colour**: `Button variant="primary"` for the one main action per view; others `secondary` (default), `ghost` or `link`. Destructive: `danger`.
- Status: always `<StatusBadge status="DRAFT|TEST_PUBLISHED|PRODUCTION_PUBLISHED|SCHEDULED|ACTIVE|SENDING|PREPARING|COMPLETED|PAUSED|FAILED|ARCHIVED" />`, never a hand-made pill. Generic labels: `<Tag tone="neutral|success|warning|error|brand">` (`brand` is only for merge fields like `{{first_name}}`).
- Plum (`plum-*`) is an accent, never action or status.
- Copy: Title Case for labels, buttons, headings and tabs ("New Campaign", "Send Date"). Full sentences stay sentence case.

## Token class families (all compiled into styles.css)
| Use | Classes |
|---|---|
| Text | `text-ink-900` (primary), `text-ink-800` (labels, helper), `text-ink-700` (secondary), `text-ink-300` (placeholder/disabled), `text-link`, `text-on-brand` |
| Surfaces | `bg-canvas`, `bg-surface`, `bg-surface-subtle`, `bg-surface-hover`, `bg-surface-sunken`, `bg-surface-overlay`, `bg-fill-subtle` |
| Borders | `border-line`, `border-line-subtle`, `border-line-control` |
| Brand | `bg-brand-600`, `bg-brand-100`, `text-brand-800` |
| Feedback | `bg-success-bg text-success-text`, `bg-warning-bg text-warning-text`, `bg-danger-bg text-danger-text` |
| Charts | `chart-1` … `chart-6` (use as `var(--color-chart-1)`) |
| Type scale | `text-page-title`, `text-section-title`, `text-card-title`, `text-card-heading`, `text-kpi`, `text-body`, `text-sm`, `text-helper`, `text-label`, `text-caption`, `text-overline`, `text-xs`; numbers add `cep-num` (tabular) |
| Radius | `rounded-xs`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` |

Every `--color-*` token is also usable as `var(--color-<name>)`. Spacing uses the standard Tailwind scale (`p-4`, `gap-3`, `px-6`).

## Building pages
- Forms: `Field` (its child is a function receiving `{id, describedBy, invalid}`) wrapping `TextInput`, `TextArea`, `Select` or `SelectMenu`; group with `FormSection`. Toggles: `Switch`, `Checkbox`, `SegmentedControl`.
- List pages: `PageHeader` + `FilterChip`/`SingleSelectMenu`/`MultiSelectMenu` filters + `DataTable` (`columns` = `{key, header, render}`; pass `rows`, `rowKey`, `caption`). Empty or failed loads use `EmptyState` / `ErrorState`.
- Overlays: `Modal`, `Drawer`, `SetupDialog` (multi-step), `Popover` + `MenuRow` for menus, `Tooltip`. Inline messages use `Notice`.
- Full prop contracts: `components/<group>/<Name>/<Name>.d.ts`; token values: `_ds_bundle.css` (`@theme` block at the top).

```jsx
const { PageHeader, Button, DataTable, StatusBadge, PlusIcon } = window.CEP
<main className="min-h-screen bg-canvas p-8">
  <PageHeader title="Campaigns" description="Plan, test and send email and SMS campaigns."
    actions={<Button variant="primary" iconStart={PlusIcon}>New Campaign</Button>} />
  <DataTable caption="Campaigns" rowKey={(r) => r.id} rows={rows} columns={[
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'sent', header: 'Sent', align: 'right', render: (r) => <span className="cep-num">{r.sent}</span> },
  ]} />
</main>
```
