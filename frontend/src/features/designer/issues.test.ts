import { expect, test } from 'vitest'

import type { DesignFindings, PersonalizationTag } from '@/lib/types'

import { blockTargetForIssue, blockTargetForLink, computeIssues, issueLines, PLACEHOLDER_IMAGE_MESSAGE, PREHEADER_MAX, SUBJECT_ADVISORY, SUBJECT_MAX, summarise, type IssueInput } from './issues'

const tag = (tag_key: string): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: 'x', default_value: null, static_value: null, is_active: true,
})

const catalogue = [tag('first_name'), tag('offer_code')]

const findings = (over: Partial<DesignFindings> = {}): DesignFindings => ({
  tags_used: [], unknown_tags: [], missing_unsubscribe: false, missing_subject: false, html_bytes: 2048, may_be_clipped: false, ...over,
})

const input = (over: Partial<IssueInput> = {}): IssueInput => ({
  channel: 'EMAIL', subject: 'Your autumn rewards', preheader: 'A short look inside', tags: catalogue,
  savedVersion: 1, dirty: false, ...over,
})

const ids = (over: Partial<IssueInput> = {}) => computeIssues(input(over)).map((issue) => issue.id)
const only = (over: Partial<IssueInput> = {}) => {
  const issues = computeIssues(input(over))
  expect(issues).toHaveLength(1)
  return issues[0]
}

test('a saved design with a valid subject has nothing to report', () => {
  expect(computeIssues(input())).toEqual([])
  expect(summarise(computeIssues(input()))).toEqual({ errors: 0, warnings: 0, canContinue: true, note: 'No errors.' })
})

test('an empty subject is an error against the subject field', () => {
  const issue = only({ subject: '' })
  expect(issue.id).toBe('subject-missing')
  expect(issue.severity).toBe('error')
  expect(issue.target).toEqual({ kind: 'field', field: 'subject' })
  expect(issue.source).toBe('live')
})

test('a whitespace-only subject counts as empty', () => {
  expect(only({ subject: '   \n\t ' }).id).toBe('subject-missing')
})

test('the subject advisory starts one character past 60 and becomes an error one past 300', () => {
  expect(ids({ subject: 'a'.repeat(SUBJECT_ADVISORY) })).toEqual([])
  expect(ids({ subject: 'a'.repeat(SUBJECT_ADVISORY + 1) })).toEqual(['subject-long'])
  expect(ids({ subject: 'a'.repeat(SUBJECT_MAX) })).toEqual(['subject-long'])
  expect(ids({ subject: 'a'.repeat(SUBJECT_MAX + 1) })).toEqual(['subject-too-long'])
})

test('a long subject is advice only and still allows continuing', () => {
  const issues = computeIssues(input({ subject: 'a'.repeat(120) }))
  expect(issues[0].severity).toBe('warning')
  expect(issues[0].message).toContain('120 characters')
  expect(issues[0].message).toContain('about 60 characters')
  expect(summarise(issues).canContinue).toBe(true)
})

test('an over-long subject reports the actual length and the limit', () => {
  const issue = only({ subject: 'a'.repeat(301) })
  expect(issue.message).toBe('The subject line is 301 characters. Shorten it to 300 or fewer.')
})

test('the preheader is fine at the limit and an error one past it', () => {
  expect(ids({ preheader: 'p'.repeat(PREHEADER_MAX) })).toEqual([])
  const issue = only({ preheader: 'p'.repeat(PREHEADER_MAX + 1) })
  expect(issue.id).toBe('preheader-too-long')
  expect(issue.target).toEqual({ kind: 'field', field: 'preheader' })
  expect(issue.message).toBe('The preheader is 301 characters. Shorten it to 300 or fewer.')
})

test('an unknown tag in the subject is an error pointing at the subject', () => {
  const issue = only({ subject: 'Hi {{offer_cod}}' })
  expect(issue.id).toBe('unknown-tag:offer_cod')
  expect(issue.message).toContain('{{offer_cod}}')
  expect(issue.target).toEqual({ kind: 'field', field: 'subject' })
  expect(issue.source).toBe('live')
})

test('an unknown tag only in the preheader points at the preheader', () => {
  expect(only({ preheader: 'See {{mystery}}' }).target).toEqual({ kind: 'field', field: 'preheader' })
})

test('known tags raise nothing', () => {
  expect(ids({ subject: 'Hi {{first_name}}', preheader: 'Code {{offer_code}}' })).toEqual([])
})

test('the same unknown tag from the body and from a field merges into one issue, keeping the field target', () => {
  const issues = computeIssues(input({ subject: 'Hi {{offer_cod}}', findings: findings({ unknown_tags: ['offer_cod'] }) }))
  expect(issues).toHaveLength(1)
  expect(issues[0].target).toEqual({ kind: 'field', field: 'subject' })
  expect(issues[0].source).toBe('live')
})

test('an unknown tag found only by the server targets the design', () => {
  const issue = only({ findings: findings({ unknown_tags: ['body_only'] }) })
  expect(issue.id).toBe('unknown-tag:body_only')
  expect(issue.target).toEqual({ kind: 'design' })
  expect(issue.source).toBe('saved')
})

test('a server-reported missing subject merges with the live check into one issue', () => {
  const issues = computeIssues(input({ subject: '', findings: findings({ missing_subject: true }) }))
  expect(issues.map((issue) => issue.id)).toEqual(['subject-missing'])
  expect(issues[0].source).toBe('live')
})

test('a missing subject reported only by the server is saved-sourced', () => {
  expect(only({ findings: findings({ missing_subject: true }) }).source).toBe('saved')
})

test('the unsubscribe warning applies to EMAIL but not to a transactional receipt', () => {
  const issue = only({ findings: findings({ missing_unsubscribe: true }) })
  expect(issue.id).toBe('missing-unsubscribe')
  expect(issue.severity).toBe('warning')
  expect(issue.message).toContain('{{unsubscribe_url}}')
  expect(ids({ channel: 'E_RECEIPT', findings: findings({ missing_unsubscribe: true }) })).toEqual([])
})

test('a clipped design reports its size in KB', () => {
  const issue = only({ findings: findings({ may_be_clipped: true, html_bytes: 120 * 1024 }) })
  expect(issue.id).toBe('may-be-clipped')
  expect(issue.message).toBe('The HTML is 120 KB. Gmail clips messages over 102 KB.')
})

test('an unsaved design reports not-saved and suppresses every saved finding', () => {
  const issues = computeIssues(input({ savedVersion: 0, findings: findings({ unknown_tags: ['x'], missing_unsubscribe: true, may_be_clipped: true }) }))
  expect(issues.map((issue) => issue.id)).toEqual(['not-saved'])
  expect(issues[0].message).toBe('Save the email once before continuing.')
  expect(issues[0].source).toBe('live')
})

test('a design blocker from a failed activate maps to the same not-saved issue', () => {
  const issue = only({ blockers: { design: 'Design and save the email before activating.' } })
  expect(issue.id).toBe('not-saved')
  expect(issue.source).toBe('saved')
})

test('a subject_line blocker raises subject-missing once', () => {
  expect(ids({ blockers: { subject_line: 'Add a subject line.' } })).toEqual(['subject-missing'])
  expect(ids({ subject: '', blockers: { subject_line: 'Add a subject line.' } })).toEqual(['subject-missing'])
})

test('a tags blocker is used verbatim only when there are no findings to be more precise', () => {
  const issue = only({ blockers: { tags: 'Unknown personalization tags: {{offer_cod}}' } })
  expect(issue.id).toBe('unknown-tags')
  expect(issue.message).toBe('Unknown personalization tags: {{offer_cod}}')
  expect(issue.target).toEqual({ kind: 'design' })

  // findings name the keys, so the per-key issues win and the blanket blocker is dropped
  expect(ids({ findings: findings({ unknown_tags: ['offer_cod'] }), blockers: { tags: 'Unknown personalization tags: {{offer_cod}}' } })).toEqual(['unknown-tag:offer_cod'])
})

test('stale marks saved issues once the design has unsaved changes, and never live ones', () => {
  const clean = computeIssues(input({ subject: '', findings: findings({ missing_unsubscribe: true }) }))
  expect(clean.map((issue) => [issue.source, issue.stale])).toEqual([['live', false], ['saved', false]])

  const dirty = computeIssues(input({ subject: '', dirty: true, findings: findings({ missing_unsubscribe: true }) }))
  expect(dirty.map((issue) => [issue.source, issue.stale])).toEqual([['live', false], ['saved', true]])
})

test('errors come before warnings, each in the documented order', () => {
  const issues = computeIssues(
    input({
      subject: 'x'.repeat(301) + ' {{nope}}',
      preheader: 'p'.repeat(301),
      savedVersion: 0,
      findings: findings({ missing_unsubscribe: true, may_be_clipped: true }),
      blockers: { design: 'Design and save the email before activating.' },
    }),
  )
  expect(issues.map((issue) => issue.id)).toEqual(['subject-too-long', 'preheader-too-long', 'unknown-tag:nope', 'not-saved'])
  expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
})

test('warnings keep their documented order behind the errors', () => {
  const issues = computeIssues(input({ subject: 'a'.repeat(120), findings: findings({ missing_unsubscribe: true, may_be_clipped: true, html_bytes: 110 * 1024 }) }))
  expect(issues.map((issue) => issue.id)).toEqual(['subject-long', 'missing-unsubscribe', 'may-be-clipped'])
})

test('summarise counts, blocks and words the note', () => {
  const error = { id: 'e', severity: 'error' as const, message: '', target: { kind: 'design' as const }, source: 'live' as const, stale: false }
  const warning = { ...error, severity: 'warning' as const }

  expect(summarise([error])).toMatchObject({ errors: 1, warnings: 0, canContinue: false, note: '1 error must be fixed.' })
  expect(summarise([error, error, error]).note).toBe('3 errors must be fixed.')
  expect(summarise([warning])).toMatchObject({ errors: 0, warnings: 1, canContinue: true, note: '1 warning · advisory only.' })
  expect(summarise([warning, warning]).note).toBe('2 warnings · advisory only.')
  // warnings do not change the note while an error is outstanding
  expect(summarise([error, warning, warning])).toMatchObject({ errors: 1, warnings: 2, canContinue: false, note: '1 error must be fixed.' })
})

test('computeIssues does not mutate its input', () => {
  const source = input({ subject: 'Hi {{nope}}', findings: findings({ unknown_tags: ['other'] }), blockers: { tags: 'x' } })
  const snapshot = structuredClone(source)
  computeIssues(source)
  expect(source).toEqual(snapshot)
})

// ---- images without alt text --------------------------------------------

const noAlt = (...labels: string[]) => labels.map((label, index) => ({ id: `image-no-alt:${index}`, label, nth: index }))

test('a design with no images, or with described images, reports nothing', () => {
  expect(computeIssues(input())).toEqual([])
  expect(computeIssues(input({ imagesWithoutAlt: [] }))).toEqual([])
})

test('each image without alt text is one warning, never an error', () => {
  const issue = only({ imagesWithoutAlt: noAlt('hero.png') })

  expect(issue.severity).toBe('warning')
  expect(issue.id).toBe('image-no-alt:0')
  expect(issue.message).toBe('hero.png has no alt text. Add one so the message still reads with images turned off.')
  // the row names the block, so clicking it can select that image and open its Alt text field
  expect(issue.target).toEqual({ kind: 'block', block: { tag: 'mj-image', nth: 0, setting: 'alt' } })
  expect(issue.source).toBe('live')
  expect(issue.stale).toBe(false)
})

test('one warning per undescribed image', () => {
  expect(ids({ imagesWithoutAlt: noAlt('hero.png', 'logo.png', 'Image') })).toEqual(['image-no-alt:0', 'image-no-alt:1', 'image-no-alt:2'])
})

test('alt text never gates activation and never reaches the error count', () => {
  const summary = summarise(computeIssues(input({ imagesWithoutAlt: noAlt('hero.png') })))

  expect(summary).toEqual({ errors: 0, warnings: 1, canContinue: true, note: '1 warning · advisory only.' })
  expect(summarise(computeIssues(input({ imagesWithoutAlt: noAlt('a.png', 'b.png') }))).note).toBe('2 warnings · advisory only.')
})

test('alt warnings sort after the errors, like every other warning', () => {
  const found = computeIssues(input({ subject: '', imagesWithoutAlt: noAlt('hero.png') }))

  expect(found.map((issue) => issue.severity)).toEqual(['error', 'warning'])
  expect(summarise(found).canContinue).toBe(false) // the empty subject blocks, not the image
})

test('an issue that names a block says which one, and one that does not says nothing', () => {
  const image = only({ imagesWithoutAlt: noAlt('hero.png') })
  expect(blockTargetForIssue(image)).toEqual({ tag: 'mj-image', nth: 0, setting: 'alt' })

  const subject = computeIssues(input({ subject: '' })).find((item) => item.id === 'subject-missing')!
  expect(blockTargetForIssue(subject)).toBe(null)
})

test('a link row points at its own block, and an anchor inside text points at none', () => {
  expect(blockTargetForLink({ block: { tag: 'mj-button', nth: 2 } })).toEqual({ tag: 'mj-button', nth: 2, setting: 'href' })
  expect(blockTargetForLink({ block: null })).toBe(null)
})

test('a placeholder image is advice, never an error, and never stops a save', () => {
  const issues = computeIssues(input({ placeholderImages: [{ id: 'image-placeholder:0', label: 'Image', nth: 0 }] }))
  const row = issues.find((issue) => issue.id === 'image-placeholder:0')
  expect(row?.severity).toBe('warning')
  expect(row?.message).toBe(PLACEHOLDER_IMAGE_MESSAGE)
  expect(summarise(issues).errors).toBe(0)
  expect(summarise(issues).canContinue).toBe(true)
})

test('the placeholder row sends the reader to that image, at the picture itself', () => {
  const issues = computeIssues(input({ placeholderImages: [{ id: 'image-placeholder:2', label: 'Image', nth: 2 }] }))
  const row = issues.find((issue) => issue.id === 'image-placeholder:2')
  expect(blockTargetForIssue(row!)).toEqual({ tag: 'mj-image', nth: 2, setting: 'src' })
})

test('one row per placeholder image, and none when there are none', () => {
  const two = computeIssues(input({ placeholderImages: [
    { id: 'image-placeholder:0', label: 'Image', nth: 0 },
    { id: 'image-placeholder:1', label: 'Image', nth: 1 },
  ] }))
  expect(two.filter((issue) => issue.message === PLACEHOLDER_IMAGE_MESSAGE)).toHaveLength(2)
  expect(computeIssues(input()).filter((issue) => issue.message === PLACEHOLDER_IMAGE_MESSAGE)).toHaveLength(0)
})

// ---- a row's two lines ---------------------------------------------------

test('an issue row reads as a title, then what to do about it', () => {
  expect(issueLines('The subject line is empty. Add one before activating.')).toEqual({
    title: 'The subject line is empty',
    detail: 'Add one before activating.',
  })
})

test('a single sentence is a title alone, without its full stop', () => {
  expect(issueLines('Save the email once before continuing.')).toEqual({ title: 'Save the email once before continuing', detail: null })
  expect(issueLines(PLACEHOLDER_IMAGE_MESSAGE)).toEqual({ title: 'This image is still a placeholder', detail: null })
})

test('a tag or a size inside the first sentence does not split it early', () => {
  expect(issueLines('No {{unsubscribe_url}} link yet. Add one before a marketing campaign uses this template.').title).toBe('No {{unsubscribe_url}} link yet')
  expect(issueLines('The HTML is 110 KB. Gmail clips messages over 102 KB.')).toEqual({ title: 'The HTML is 110 KB', detail: 'Gmail clips messages over 102 KB.' })
})

test('every message the checks write splits into a title and, where there is one, a detail', () => {
  const issues = computeIssues({
    channel: 'EMAIL', subject: '', preheader: 'x'.repeat(200), tags: [], savedVersion: 0, dirty: true,
    imagesWithoutAlt: [{ id: 'img1', label: 'hero.png', nth: 0 }],
  })
  expect(issues.length).toBeGreaterThan(0)
  for (const issue of issues) {
    const { title, detail } = issueLines(issue.message)
    expect(title.length, issue.id).toBeGreaterThan(0)
    expect(title.endsWith('.'), issue.id).toBe(false)
    expect(`${title}${detail ? `. ${detail}` : '.'}`, issue.id).toBe(issue.message.endsWith('.') ? issue.message : `${issue.message}.`)
  }
})
