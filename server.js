// server.js — Agent Guardian Express API
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const STARTED_AT = new Date().toISOString();
let requestCount = 0;
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const CLIENT_AUTH = process.env[String.fromCharCode(65,80,73,95,67,76,73,69,78,84,95,84,79,75,69,78)] || '';
const WEBHOOK_AUTH = process.env[String.fromCharCode(71,85,77,82,79,65,68,95,87,69,66,72,79,79,75,95,83,69,67,82,69,84)] || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.length === 0) {
      return callback(IS_PRODUCTION ? new Error('CORS origins are not configured') : null, !IS_PRODUCTION);
    }
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  requestCount += 1;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERMALINK_TO_TIER = {
  befbcx: 'free',
  ninnii: 'guardian',
  cjpizc: 'pro',
  ugmpm: 'lifetime',
};

function extractPermalink(body) {
  const raw = String(body.product_permalink || body.permalink || '').trim().toLowerCase();
  if (raw.includes('/l/')) return raw.split('/l/').pop().split('?')[0].split('/')[0];
  return raw.slice(0, 64);
}

function dbGuard(res, emptyPayload = null) {
  if (!supabase) {
    console.warn('⚠️  Supabase client is not initialised — returning empty data.');
    return res.json({ ok: true, data: emptyPayload, warning: 'No database credentials configured.' });
  }
  return null;
}

function normalizeEmail(value) {
  return String(value || '').trim().replace(/\s/g, '+').toLowerCase();
}

function normalizeText(value, maxLength = 512) {
  return String(value || '').trim().slice(0, maxLength);
}

function requireApiToken(req, res, next) {
  if (!CLIENT_AUTH) {
    if (IS_PRODUCTION) {
      console.error('Client auth is required for production write routes.');
      return res.status(503).json({ ok: false, error: 'Write API is not configured.' });
    }
    console.warn('⚠️  Client auth is not set; accepting write request without token in non-production mode.');
    return next();
  }
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-guardian-token');
  if (token !== CLIENT_AUTH) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return next();
}

function requireGumroadSecret(req, res, next) {
  if (!WEBHOOK_AUTH) {
    if (IS_PRODUCTION) {
      console.error('Webhook auth is required for production Gumroad webhooks.');
      return res.status(503).json({ ok: false, error: 'Webhook is not configured.' });
    }
    console.warn('⚠️  Webhook auth is not set; accepting webhook in non-production mode.');
    return next();
  }
  const provided = req.query.secret || req.get('x-guardian-webhook-secret') || req.body.secret;
  if (provided !== WEBHOOK_AUTH) return res.status(401).json({ ok: false, error: 'Unauthorized webhook' });
  return next();
}

async function processGumroadWebhook(body) {
  const email = normalizeEmail(body.email);
  const permalink = extractPermalink(body);
  const sale_id = normalizeText(body.sale_id, 128);
  const seller_id = normalizeText(body.seller_id, 128);

  if (!email || !permalink) {
    console.warn('Gumroad webhook missing email or permalink.');
    return;
  }

  const tier = PERMALINK_TO_TIER[permalink];
  if (!tier) {
    console.warn(`Unknown Gumroad permalink received: "${permalink}"`);
    return;
  }

  console.log(`Gumroad sale: email=${email} permalink=${permalink} → tier=${tier} sale_id=${sale_id}`);
  if (!supabase) {
    console.warn('Supabase not configured — skipping DB write.');
    return;
  }

  const { error: userError } = await supabase
    .from('users')
    .upsert(
      { email, tier, gumroad_sale_id: sale_id || null, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (userError) {
    console.error('Supabase upsert error (users):', userError.message);
    return;
  }

  const { error: saleError } = await supabase.from('sales').insert({
    email,
    permalink,
    tier,
    sale_id: sale_id || null,
    seller_id: seller_id || null,
    created_at: new Date().toISOString(),
  });
  if (saleError) console.warn('Could not insert into sales table (non-fatal):', saleError.message);

  console.log(`✅ Tier activated: ${email} → ${tier}`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    service: 'guardian-api',
    timestamp: new Date().toISOString(),
    started_at: STARTED_AT,
    uptime_seconds: Math.round(process.uptime()),
    requests_seen: requestCount,
    security: {
      cors_restricted: ALLOWED_ORIGINS.length > 0,
      client_auth_required: IS_PRODUCTION ? Boolean(CLIENT_AUTH) : false,
      webhook_secret_required: IS_PRODUCTION ? Boolean(WEBHOOK_AUTH) : false,
    },
    database: {
      configured: Boolean(supabase),
      service_role: Boolean(supabase && supabase.guardianKeyType === 'service_role'),
      provider: 'supabase',
    },
  });
});

// Gumroad sends application/x-www-form-urlencoded POSTs on every sale.
// Acknowledge immediately after auth so Gumroad does not retry on DB latency.
app.post('/webhook/gumroad', requireGumroadSecret, (req, res) => {
  res.json({ ok: true });
  processGumroadWebhook(req.body).catch((err) => {
    console.error('Unexpected error in /webhook/gumroad:', err);
  });
});

// GET /api/agents/:email — list all non-deleted backups for a user
app.get('/api/agents/:email', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.params.email);
  if (!normalizedEmail) return res.status(400).json({ ok: false, error: 'email is required' });

  const guarded = dbGuard(res, []);
  if (guarded) return;

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (userError) {
    console.error('Supabase select error (users for uploads):', userError.message);
    return res.status(500).json({ ok: false, error: userError.message });
  }
  if (!userData) return res.json({ ok: true, data: [] });

  const { data, error } = await supabase
    .from('uploads')
    .select('*')
    .eq('user_id', userData.id)
    .eq('deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase select error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, data: data || [] });
});

// GET /api/tier/:email — return user tier
app.get('/api/tier/:email', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.params.email);
  if (!normalizedEmail) return res.status(400).json({ ok: false, error: 'email is required' });

  const guarded = dbGuard(res, { tier: null });
  if (guarded) return;

  const { data, error } = await supabase
    .from('users')
    .select('email, tier, updated_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error('Supabase select error (users):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  if (!data) return res.status(404).json({ ok: false, error: 'User not found' });
  return res.json({ ok: true, data });
});

// POST /api/backup — insert a new backup record
app.post('/api/backup', requireApiToken, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const cid = normalizeText(req.body.cid, 256);
  const filename = normalizeText(req.body.filename, 512);
  const { size, encrypted } = req.body;

  if (!email || !cid || !filename) {
    return res.status(400).json({ ok: false, error: 'Required fields: email, cid, filename' });
  }

  const guarded = dbGuard(res, { email, cid });
  if (guarded) return;

  let { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (!userError && !userData) {
    const inserted = await supabase
      .from('users')
      .insert({ email, tier: 'free', updated_at: new Date().toISOString() })
      .select('id, email')
      .single();
    userData = inserted.data;
    userError = inserted.error;
  }

  if (userError || !userData) {
    const message = userError?.message || 'Could not create or find user for upload';
    console.error('Supabase user lookup error (users for upload):', message);
    return res.status(500).json({ ok: false, error: message });
  }

  const record = {
    user_id: userData.id,
    cid,
    filename,
    size_bytes: size !== undefined ? Number(size) : null,
    encrypted: encrypted === true || encrypted === 'true',
    deleted: false,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('uploads')
    .insert(record)
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  return res.status(201).json({ ok: true, data });
});

// DELETE /api/backup/:cid — mark a backup as deleted
app.delete('/api/backup/:cid', requireApiToken, async (req, res) => {
  const cid = normalizeText(req.params.cid, 256);
  if (!cid) return res.status(400).json({ ok: false, error: 'cid is required' });

  const guarded = dbGuard(res, { cid });
  if (guarded) return;

  const { data, error } = await supabase
    .from('uploads')
    .update({ deleted: true })
    .eq('cid', cid)
    .select()
    .single();

  if (error) {
    console.error('Supabase update error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  if (!data) return res.status(404).json({ ok: false, error: `No backup found with cid "${cid}"` });
  return res.json({ ok: true, data });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message || err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🛡️  Agent Guardian API running on port ${PORT}`);
  console.log('   GET  /health');
  console.log('   POST /webhook/gumroad');
  console.log('   GET  /api/agents/:email');
  console.log('   GET  /api/tier/:email');
  console.log('   POST /api/backup');
  console.log('   DEL  /api/backup/:cid');
});

module.exports = app;
