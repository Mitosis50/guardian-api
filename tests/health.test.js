/**
 * tests/health.test.js — Health, metrics, and validation endpoints
 */

'use strict'

const request = require('supertest')
const app = require('../server')

describe('GET /health', () => {
  it('returns 200 with service health snapshot', async () => {
    const res = await request(app).get('/health')
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      status: 'ok',
      service: 'guardian-api',
    })
    expect(res.body).toHaveProperty('timestamp')
    expect(res.body).toHaveProperty('uptime_seconds')
    expect(res.body).toHaveProperty('requests_seen')
    expect(res.body).toHaveProperty('security')
    expect(res.body).toHaveProperty('database')
  })

  it('sets security headers', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('does not expose x-powered-by', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /api/metrics', () => {
  it('returns 200 with runtime metrics and incidents', async () => {
    const res = await request(app)
      .get('/api/metrics')
      .set('Authorization', 'Bearer test-client-token')
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('ok')
    expect(res.body).toHaveProperty('status')
    expect(res.body).toHaveProperty('timestamp')
    expect(res.body).toHaveProperty('health')
    expect(res.body).toHaveProperty('metrics')
    expect(res.body).toHaveProperty('incidents')
    expect(Array.isArray(res.body.incidents)).toBe(true)
  })
})

describe('GET /api/validate-health', () => {
  it('returns 200 with check list and incident summary', async () => {
    const res = await request(app)
      .get('/api/validate-health')
      .set('Authorization', 'Bearer test-client-token')
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('ok')
    expect(res.body).toHaveProperty('status')
    expect(res.body.status).toMatch(/validated|attention_required/)
    expect(res.body).toHaveProperty('checks')
    expect(Array.isArray(res.body.checks)).toBe(true)
    expect(res.body.checks.length).toBeGreaterThanOrEqual(5)
    expect(res.body).toHaveProperty('incidents')
  })
})
