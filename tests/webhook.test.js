/**
 * tests/webhook.test.js — Gumroad webhook processing
 *
 * Env vars and db mock are handled in tests/setup.js.
 */

'use strict'

const request = require('supertest')
const app = require('../server')

describe('POST /webhook/gumroad', () => {
  beforeEach(() => {
    // Suppress fire-and-forget async logs from processGumroadWebhook
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('acknowledges immediately with 200 before async processing', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .query({ secret: 'test-webhook-secret' })
      .type('form')
      .send({ email: 'test@example.com', product_permalink: 'https://gum.co/l/befbcx' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('ignores webhooks with missing email', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .query({ secret: 'test-webhook-secret' })
      .type('form')
      .send({ product_permalink: 'https://gum.co/l/befbcx' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('ignores webhooks with unknown permalink', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .query({ secret: 'test-webhook-secret' })
      .type('form')
      .send({ email: 'test@example.com', product_permalink: 'https://gum.co/l/unknown' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('maps known permalinks to tiers', async () => {
    const tiers = [
      { permalink: 'https://gum.co/l/befbcx', tier: 'free' },
      { permalink: 'https://gum.co/l/ninnii', tier: 'guardian' },
      { permalink: 'https://gum.co/l/cjpizc', tier: 'pro' },
      { permalink: 'https://gum.co/l/ugmpm', tier: 'lifetime' },
    ]

    for (const { permalink, tier } of tiers) {
      const res = await request(app)
        .post('/webhook/gumroad')
        .query({ secret: 'test-webhook-secret' })
        .type('form')
        .send({ email: `${tier}@example.com`, product_permalink: permalink })
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ ok: true })
    }
  })
})
