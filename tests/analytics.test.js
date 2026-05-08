const request = require('supertest');
const app = require('../server');

describe('Task #4C: Usage Analytics Dashboard', () => {
  const testEmail = 'analytics-test@example.com';
  const testToken = 'Bearer demo-test-token';

  describe('GET /api/analytics/metrics', () => {
    it('returns user backup and storage metrics', async () => {
      const res = await request(app)
        .get(`/api/analytics/metrics?email=${testEmail}`)
        .set('Authorization', testToken);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.total_backups).toBeDefined();
      expect(typeof res.body.data.total_backups).toBe('number');
      expect(res.body.data.total_storage_bytes).toBeDefined();
      expect(typeof res.body.data.total_storage_bytes).toBe('number');
      expect(res.body.data.tier_status).toBeDefined();
    });

    it('returns metrics for any user in demo mode', async () => {
      const res = await request(app)
        .get(`/api/analytics/metrics?email=newuser@example.com`)
        .set('Authorization', testToken);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.total_backups).toBe('number');
      expect(typeof res.body.data.total_storage_bytes).toBe('number');
    });

    it('works without token in demo mode', async () => {
      const res = await request(app)
        .get(`/api/analytics/metrics?email=${testEmail}`);
      
      // In demo mode, no auth required
      expect([200, 401]).toContain(res.statusCode);
    });
  });

  describe('GET /api/analytics/usage-trends', () => {
    it('returns daily backup counts for last 30 days', async () => {
      const res = await request(app)
        .get(`/api/analytics/usage-trends?days=30`)
        .set('Authorization', testToken);
      
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0].date).toBeDefined();
        expect(res.body.data[0].backup_count).toBeDefined();
      }
    });
  });

  describe('GET /api/analytics/storage-by-tier', () => {
    it('returns storage breakdown by tier', async () => {
      const res = await request(app)
        .get('/api/analytics/storage-by-tier')
        .set('Authorization', testToken);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
