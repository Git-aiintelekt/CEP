# Input validation

Every limit a form shows comes from the table the field is saved to. The server publishes its rules once, the form
reads them, and the server keeps checking: the rules in the browser are a copy of the server's, never a replacement.

## The rules: `GET /api/v1/field-rules/`

One document for the whole API, built from the serializers (which take their lengths from the models and so from the
tables). Needs a login; cached privately for an hour. Shape:

```json
{
  "generated_at": "2026-10-02T04:00:00+00:00",
  "resources": {
    "campaign": {
      "name": { "type": "string", "required": true, "label": "Name", "max": 200, "min": null, "blank": false,
                "column": { "table": "campaign", "column": "name", "type": "CharField", "max": 200 } },
      "description": { "type": "string", "required": false, "max": null, "nullable": true, "column": { "table": "campaign", "column": "description", "type": "TextField", "max": null } },
      "channel": { "type": "choice", "required": true, "choices": [{ "value": "EMAIL", "label": "Email" }] }
    }
  }
}
```

- `type`: `string`, `email`, `url`, `slug`, `uuid`, `boolean`, `integer`, `decimal`, `datetime`, `date`, `time`, `choice`,
  `choices`, `reference`, `references`, `list`, `object`, `json`.
- `max` / `min`: characters, for the string types. `max` is `null` when the column is unlimited text; the form then keeps
  a ceiling of its own so the counter still has one.
- `min_value` / `max_value` / `decimal_places` / `max_digits` for numbers; `choices` for choice fields; `pattern` when a
  RegexValidator is on the field.
- `column`: the table and column behind a model-backed field.
- Read-only fields and the primary key are left out.

The resources are listed in `backend/api/v1/field_rules.py` (`RESOURCES`): campaign, template, personalization_tag,
journey, contact_list, new_contact_list, sender_profile, delivery_provider, subscription_topic, store, user, role,
api_client, mail_server, identity_provider. Add a serializer there to publish its rules.

## In the browser

`src/lib/fieldRules.ts`:

- `useFieldRules(resource)` fetches the document once per session and returns `rule(field)`; dotted paths walk into
  object rules. Until the rules arrive (or with no backend) every rule is `null`, so a form writes `rule('name')?.max ?? 200`
  and its own number stands in.
- `limitTone({ used, max, soft })`: `quiet` with room, `warn` in the last 10%, `over` at the limit. A `soft` limit is counted
  first: a preheader is counted against the 90 characters an inbox shows while the table allows 300.
- `stringFromRule(rule, fallbackMax)` builds the Zod check with the wording the forms already use.

`src/components/Form.tsx`:

- `<Field limit={{ used, max, soft? }}>` puts a `<Counter>` ("42 / 200") at the end of the label row, beside any other
  `labelEnd` content. Grey, amber in the last 10%, red at the limit. Nothing shows when `max` is `null`.
- The input still sets `maxLength` from the same rule, so typing stops at the limit.

A form adopts it with one hook and two props:

```tsx
const rule = useFieldRules('campaign')
<Field label="Campaign Name" required limit={{ used: name.length, max: rule('name')?.max ?? 200 }}>
  {(ids) => <TextInput {...ids} {...register('name')} maxLength={rule('name')?.max ?? 200} />}
</Field>
```

Forms with the counter today: campaign setup (name, code, description), the campaign's subject line and preheader,
targets notes, approval notes, drip step labels, new template and template form (name), contact list name and copy name,
Settings → Tags (key, label). Numbers, dates and choices show no counter; their rule is the type.

## On the server

DRF validates every request against the same serializers: an over-length value answers 400 with the field named in
`errors`, the same shape the API client already maps onto the form (`ApiError.fieldErrors`). The scratch suite
`test_field_rules.py` checks that a 201-character campaign name and a 41-character code are refused on their fields.
