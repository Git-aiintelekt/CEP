import { describe, expect, test } from 'vitest'

import { isWebhookConfigured, summarizeWebhook, webhookHost, webhookProblem } from './WebhookFields'

describe('the Webhook step', () => {
  test('the address must be https, or http on localhost', () => {
    expect(webhookProblem({})).toBeNull()
    expect(isWebhookConfigured({})).toBe(false)
    expect(webhookProblem({ url: 'https://hooks.example.com/cep' })).toBeNull()
    expect(isWebhookConfigured({ url: 'https://hooks.example.com/cep' })).toBe(true)
    expect(webhookProblem({ url: 'http://hooks.example.com/cep' })).toContain('https')
    expect(webhookProblem({ url: 'http://localhost:9000/cep' })).toBeNull()
    expect(webhookProblem({ url: 'not a url' })).toBe('The address is a full http(s) URL.')
  })

  test("the card's line names the host", () => {
    expect(webhookHost({ url: 'https://hooks.example.com/cep?x=1' })).toBe('hooks.example.com')
    expect(summarizeWebhook({ url: 'https://hooks.example.com/cep' })).toBe('Webhook: hooks.example.com')
    expect(summarizeWebhook({})).toBe('No address set')
  })
})
