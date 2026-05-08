/**
 * tests/backup.test.js — Backup POST / DELETE routes
 *
 * Env vars and db mock are handled in tests/setup.js.
 */

'use strict'

const request = require('supertest')
const app = require('../server')

describe('POST /api/backup', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/backup')
      .send({ email: 'test@example.com', cid: 'QmTest', filename: 'memory.md' })
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized' })
  })

  it('rejects requests with missing fields', async () => {
    const res = await request(app)
      .post('/api/backup')
      .set('Authorization', 'Bearer test-client-token')
      .send({ email: 'test@example.com' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ ok: false, error: 'Required fields: email, cid, filename' })
  })

  it('returns fallback when database is not configured', async () => {
    const res = await request(app)
      .post('/api/backup')
      .set('Authorization', 'Bearer test-client-token')
      .send({ email: 'test@example.com', cid: 'QmTest123', filename: 'memory.md', size: 1024 })
    // dbGuard returns early with warning when supabase is null
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, warning: 'No database credentials configured.' })
  })
})

describe('DELETE /api/backup/:cid', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).delete('/api/backup/QmTest')
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, error: 'Unauthorized' })
  })

  it('rejects requests with missing cid param', async () => {
    const res = await request(app)
      .delete('/api/backup/')
      .set('Authorization', 'Bearer test-client-token')
    expect(res.statusCode).toBe(404)
  })

  it('returns fallback when database is not configured', async () => {
    const res = await request(app)
      .delete('/api/backup/QmTest123')
      .set('Authorization', 'Bearer test-client-token')
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, warning: 'No database credentials configured.' })
  })
})
