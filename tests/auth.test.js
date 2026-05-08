/**
 * tests/auth.test.js — Auth middleware and protected routes
 *
 * Env vars and db mock are handled in tests/setup.js.
 */

'use strict'

const request = require('supertest')
const app = require('../server')

describe('requireApiToken — /api/cron/heartbeat', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).post('/api/cron/heartbeat').send({ status: 'ok' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized' })
  })

  it('rejects requests with an invalid token', async () => {
    const res = await request(app)
      .post('/api/cron/heartbeat')
      .set('Authorization', 'Bearer wrong-token')
      .send({ status: 'ok' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized' })
  })

  it('accepts requests with a valid Bearer token', async () => {
    const res = await request(app)
      .post('/api/cron/heartbeat')
      .set('Authorization', 'Bearer test-client-token')
      .send({ status: 'ok' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
    expect(res.body.data).toHaveProperty('heartbeats')
    expect(res.body.data).toHaveProperty('last_heartbeat_at')
  })

  it('accepts requests with a valid x-guardian-token header', async () => {
    const res = await request(app)
      .post('/api/cron/heartbeat')
      .set('x-guardian-token', 'test-client-token')
      .send({ status: 'ok' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })
})

describe('requireGumroadSecret — /webhook/gumroad', () => {
  it('rejects requests without a secret', async () => {
    const res = await request(app).post('/webhook/gumroad').type('form').send({ email: 'a@b.com' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized webhook' })
  })

  it('rejects requests with an invalid secret', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .query({ secret: 'wrong-secret' })
      .type('form')
      .send({ email: 'a@b.com' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized webhook' })
  })

  it('accepts requests with a valid query secret', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .query({ secret: 'test-webhook-secret' })
      .type('form')
      .send({ email: 'test@example.com', product_permalink: 'https://gum.co/l/befbcx' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })

  it('accepts requests with a valid x-guardian-webhook-secret header', async () => {
    const res = await request(app)
      .post('/webhook/gumroad')
      .set('x-guardian-webhook-secret', 'test-webhook-secret')
      .type('form')
      .send({ email: 'test@example.com', product_permalink: 'https://gum.co/l/befbcx' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })
})
