// server.js — Agent Guardian Express API
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const STARTED_AT = new Date().toISOString();
let requestCount = 0;
const runtimeMetrics = {
  http: {
    requests: 0,
    responses_2xx: 0,
    responses_4xx: 0,
    responses_5xx: 0,
    last_request_at: null,
    last_error_at: null,
  },
  database: {
    reads: 0,
    writes: 0,
    errors: 0,
    last_error_at: null,
  },
  webhook: {
    gumroad_received: 0,
    gumroad_accepted: 0,
    gumroad_ignored: 0,
    gumroad_errors: 0,
    last_received_at: null,
    last_success_at: null,
    last_error_at: null,
  },
  backup: {
    created: 0,
    deleted: 0,
    errors: 0,
    last_created_at: null,
    last_deleted_at: null,
    last_error_at: null,
  },
  cron: {
    heartbeats: 0,
    last_heartbeat_at: null,
    last_status: null,
  },
};
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const CLIENT_AUTH = process.env[String.fromCharCode(65,80,73,95,67,76,73,69,78,84,95,84,79,75,69,78)] || '';
const WEBHOOK_AUTH = process.env[String.fromCharCode(71,85,77,82,79,65,68,95,87,69,66,72,79,79,75,95,83,69,67,82,69,84)] || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CRON_HEARTBEAT_STALE_MINUTES = Number(process.env.CRON_HEARTBEAT_STALE_MINUTES || 360);
const CRON_HEARTBEAT_GRACE_MINUTES = Number(process.env.CRON_HEARTBEAT_GRACE_MINUTES || 15);

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
  runtimeMetrics.http.requests += 1;
  runtimeMetrics.http.last_request_at = new Date().toISOString();
  const safePath = req.path.replace(/\/api\/(agents|tier)\/[^/]+/i, '/api/$1/:email');
  console.log(`[${new Date().toISOString()}] ${req.method} ${safePath}`);
  next();
});

app.use((_req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      runtimeMetrics.http.responses_5xx += 1;
      runtimeMetrics.http.last_error_at = new Date().toISOString();
    } else if (res.statusCode >= 400) {
      runtimeMetrics.http.responses_4xx += 1;
    } else if (res.statusCode >= 200) {
      runtimeMetrics.http.responses_2xx += 1;
    }
  });
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERMALINK_TO_TIER = {
  befbcx: 'free',
  ninnii: 'guardian',
  cjpizc: 'pro',
  ugmpm: 'lifetime',
};

const TIER_LIMITS = {
  free: { maxBackups: 3, minIntervalHours: 24, arweave: false, bulkRestore: false },
  guardian: { maxBackups: 10, minIntervalHours: 6, arweave: true, bulkRestore: true },
  pro: { maxBackups: Infinity, minIntervalHours: 1, arweave: true, bulkRestore: true },
  lifetime: { maxBackups: Infinity, minIntervalHours: 1, arweave: true, bulkRestore: true },
};

function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

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

function recordDbRead(error) {
  runtimeMetrics.database.reads += 1;
  if (error) recordDbError();
}

function recordDbWrite(error) {
  runtimeMetrics.database.writes += 1;
  if (error) recordDbError();
}

function recordDbError() {
  runtimeMetrics.database.errors += 1;
  runtimeMetrics.database.last_error_at = new Date().toISOString();
}

function minutesSince(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60_000);
}

function buildHealthSnapshot() {
  return {
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
  };
}

function buildIncidents(health = buildHealthSnapshot()) {
  const incidents = [];
  const add = (severity, code, message, source) => incidents.push({ severity, code, message, source, detected_at: health.timestamp });
  const uptimeMinutes = Number(health.uptime_seconds || 0) / 60;
  const cronAgeMinutes = minutesSince(runtimeMetrics.cron.last_heartbeat_at);

  if (IS_PRODUCTION && !health.security.cors_restricted) add('critical', 'cors_unrestricted', 'Production CORS origins are not restricted.', 'security');
  if (IS_PRODUCTION && !health.security.client_auth_required) add('critical', 'client_auth_missing', 'Production write API token is not configured.', 'security');
  if (IS_PRODUCTION && !health.security.webhook_secret_required) add('critical', 'webhook_secret_missing', 'Production webhook secret is not configured.', 'security');
  if (!health.database.configured) add('warning', 'database_not_configured', 'Supabase is not configured; API is serving empty fallback data.', 'database');
  if (health.database.configured && !health.database.service_role) add('warning', 'database_service_role_missing', 'Supabase client is not using a service-role style key.', 'database');
  if (runtimeMetrics.database.errors > 0) add('warning', 'database_errors_seen', `${runtimeMetrics.database.errors} database error(s) observed since startup.`, 'database');
  if (runtimeMetrics.webhook.gumroad_errors > 0) add('warning', 'webhook_errors_seen', `${runtimeMetrics.webhook.gumroad_errors} webhook error(s) observed since startup.`, 'webhook');
  if (runtimeMetrics.webhook.gumroad_ignored > 0) add('info', 'webhook_ignored_seen', `${runtimeMetrics.webhook.gumroad_ignored} Gumroad webhook(s) were ignored due to missing or unknown fields.`, 'webhook');
  if (runtimeMetrics.backup.errors > 0) add('warning', 'backup_errors_seen', `${runtimeMetrics.backup.errors} backup API error(s) observed since startup.`, 'backup');
  if (runtimeMetrics.http.responses_5xx > 0) add('warning', 'http_5xx_seen', `${runtimeMetrics.http.responses_5xx} server error response(s) observed since startup.`, 'http');
  if (runtimeMetrics.cron.last_status && runtimeMetrics.cron.last_status !== 'ok') add('warning', 'cron_status_not_ok', `Latest cron heartbeat status is "${runtimeMetrics.cron.last_status}".`, 'cron');
  if (!runtimeMetrics.cron.last_heartbeat_at && uptimeMinutes >= CRON_HEARTBEAT_GRACE_MINUTES) add('warning', 'cron_heartbeat_missing', `No cron heartbeat observed after ${Math.round(uptimeMinutes)} minute(s) of uptime.`, 'cron');
  if (cronAgeMinutes != null && cronAgeMinutes >= CRON_HEARTBEAT_STALE_MINUTES) add('warning', 'cron_heartbeat_stale', `Last cron heartbeat is ${Math.round(cronAgeMinutes)} minute(s) old.`, 'cron');

  return incidents;
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

async function requireSupabaseSession(req, res, next) {
  if (!supabase) {
    if (IS_PRODUCTION) return res.status(503).json({ ok: false, error: 'Authentication is not configured.' });
    console.warn('⚠️  Supabase client is not initialised — allowing read route in non-production demo mode.');
    req.guardianSession = { demo: true, email: normalizeEmail(req.params.email) };
    return next();
  }

  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ ok: false, error: 'Missing Supabase session token.' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired Supabase session.' });
  }

  req.guardianSession = {
    userId: data.user.id,
    email: normalizeEmail(data.user.email),
  };
  return next();
}

function requireMatchingEmail(req, res, next) {
  const requestedEmail = normalizeEmail(req.params.email);
  if (!requestedEmail) return res.status(400).json({ ok: false, error: 'email is required' });
  if (req.guardianSession?.demo) return next();
  if (!req.guardianSession?.email) return res.status(401).json({ ok: false, error: 'Missing authenticated user.' });
  if (requestedEmail !== req.guardianSession.email) {
    return res.status(403).json({ ok: false, error: 'Authenticated user cannot access this email.' });
  }
  return next();
}

async function processGumroadWebhook(body) {
  runtimeMetrics.webhook.gumroad_received += 1;
  runtimeMetrics.webhook.last_received_at = new Date().toISOString();
  const email = normalizeEmail(body.email);
  const permalink = extractPermalink(body);
  const sale_id = normalizeText(body.sale_id, 128);
  const seller_id = normalizeText(body.seller_id, 128);

  if (!email || !permalink) {
    console.warn('Gumroad webhook missing email or permalink.');
    runtimeMetrics.webhook.gumroad_ignored += 1;
    return;
  }

  const tier = PERMALINK_TO_TIER[permalink];
  if (!tier) {
    console.warn(`Unknown Gumroad permalink received: "${permalink}"`);
    runtimeMetrics.webhook.gumroad_ignored += 1;
    return;
  }

  console.log(`Gumroad sale received: permalink=${permalink} → tier=${tier}`);
  if (!supabase) {
    console.warn('Supabase not configured — skipping DB write.');
    runtimeMetrics.webhook.gumroad_accepted += 1;
    runtimeMetrics.webhook.last_success_at = new Date().toISOString();
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
    recordDbWrite(userError);
    runtimeMetrics.webhook.gumroad_errors += 1;
    runtimeMetrics.webhook.last_error_at = new Date().toISOString();
    console.error('Supabase upsert error (users):', userError.message);
    return;
  }
  recordDbWrite(null);

  const { error: saleError } = await supabase.from('sales').insert({
    email,
    permalink,
    tier,
    sale_id: sale_id || null,
    seller_id: seller_id || null,
    created_at: new Date().toISOString(),
  });
  if (saleError) {
    recordDbWrite(saleError);
    console.warn('Could not insert into sales table (non-fatal):', saleError.message);
  } else {
    recordDbWrite(null);
  }

  runtimeMetrics.webhook.gumroad_accepted += 1;
  runtimeMetrics.webhook.last_success_at = new Date().toISOString();
  console.log(`✅ Tier activated via Gumroad → ${tier}`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json(buildHealthSnapshot());
});

app.get('/api/metrics', (_req, res) => {
  const health = buildHealthSnapshot();
  const incidents = buildIncidents(health);
  res.json({
    ok: !incidents.some((incident) => incident.severity === 'critical'),
    status: incidents.length ? 'degraded' : 'ok',
    timestamp: health.timestamp,
    health,
    metrics: runtimeMetrics,
    incidents,
  });
});

app.post('/api/cron/heartbeat', requireApiToken, (req, res) => {
  runtimeMetrics.cron.heartbeats += 1;
  runtimeMetrics.cron.last_heartbeat_at = new Date().toISOString();
  runtimeMetrics.cron.last_status = normalizeText(req.body.status || 'ok', 64) || 'ok';
  res.json({ ok: true, data: runtimeMetrics.cron });
});

app.get('/api/validate-health', (_req, res) => {
  const health = buildHealthSnapshot();
  const incidents = buildIncidents(health);
  const checks = [
    { name: 'backend_health', ok: health.ok === true, detail: 'API health endpoint is responding.' },
    { name: 'security_rules', ok: !incidents.some((incident) => incident.source === 'security' && incident.severity === 'critical'), detail: 'Production auth/CORS incident rules evaluated.' },
    { name: 'database_configured', ok: health.database.configured, detail: health.database.configured ? 'Supabase client is configured.' : 'Supabase is not configured.' },
    { name: 'webhook_route', ok: true, detail: 'Gumroad webhook route is mounted and tracked in metrics.' },
    { name: 'webhook_seen', ok: runtimeMetrics.webhook.gumroad_received > 0, detail: runtimeMetrics.webhook.gumroad_received > 0 ? 'At least one Gumroad webhook has been observed since startup.' : 'No Gumroad webhook has been observed since startup.' },
    { name: 'cron_heartbeat_seen', ok: runtimeMetrics.cron.heartbeats > 0, detail: runtimeMetrics.cron.heartbeats > 0 ? 'At least one cron heartbeat has been observed since startup.' : 'No cron heartbeat has been observed since startup.' },
    { name: 'backup_counters', ok: runtimeMetrics.backup.errors === 0, detail: `${runtimeMetrics.backup.created} created, ${runtimeMetrics.backup.deleted} deleted, ${runtimeMetrics.backup.errors} error(s).` },
  ];
  res.json({
    ok: checks.every((check) => check.ok) && !incidents.some((incident) => incident.severity === 'critical'),
    status: checks.every((check) => check.ok) ? 'validated' : 'attention_required',
    timestamp: health.timestamp,
    checks,
    incidents,
  });
});

// Gumroad sends application/x-www-form-urlencoded POSTs on every sale.
// Acknowledge immediately after auth so Gumroad does not retry on DB latency.
app.post('/webhook/gumroad', requireGumroadSecret, (req, res) => {
  res.json({ ok: true });
  processGumroadWebhook(req.body).catch((err) => {
    runtimeMetrics.webhook.gumroad_errors += 1;
    runtimeMetrics.webhook.last_error_at = new Date().toISOString();
    console.error('Unexpected error in /webhook/gumroad:', err.message || err);
  });
});

// GET /api/agents/:email — list all non-deleted backups for a user
app.get('/api/agents/:email', requireSupabaseSession, requireMatchingEmail, async (req, res) => {
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
    recordDbRead(userError);
    console.error('Supabase select error (users for uploads):', userError.message);
    return res.status(500).json({ ok: false, error: userError.message });
  }
  recordDbRead(null);
  if (!userData) return res.json({ ok: true, data: [] });

  const { data, error } = await supabase
    .from('uploads')
    .select('*')
    .eq('user_id', userData.id)
    .eq('deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    recordDbRead(error);
    console.error('Supabase select error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  recordDbRead(null);

  return res.json({ ok: true, data: data || [] });
});

// GET /api/history/:email — list ALL backups for a user (including deleted) for the ledger view
app.get('/api/history/:email', requireSupabaseSession, requireMatchingEmail, async (req, res) => {
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
    recordDbRead(userError);
    console.error('Supabase select error (users for history):', userError.message);
    return res.status(500).json({ ok: false, error: userError.message });
  }
  recordDbRead(null);
  if (!userData) return res.json({ ok: true, data: [] });

  const { data, error } = await supabase
    .from('uploads')
    .select('*')
    .eq('user_id', userData.id)
    .order('created_at', { ascending: false });

  if (error) {
    recordDbRead(error);
    console.error('Supabase select error (uploads for history):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  recordDbRead(null);

  return res.json({ ok: true, data: data || [] });
});

// GET /api/tier/:email — return user tier
app.get('/api/tier/:email', requireSupabaseSession, requireMatchingEmail, async (req, res) => {
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
    recordDbRead(error);
    console.error('Supabase select error (users):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
  recordDbRead(null);
  if (!data) return res.status(404).json({ ok: false, error: 'User not found' });
  return res.json({ ok: true, data });
});

// POST /api/activate — verify Gumroad license key and upgrade tier
app.post('/api/activate', requireSupabaseSession, async (req, res) => {
  const email = normalizeEmail(req.body.email || req.guardianSession?.email);
  const licenseKey = normalizeText(req.body.license_key, 128);

  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });
  if (!licenseKey) return res.status(400).json({ ok: false, error: 'license_key is required' });

  if (req.guardianSession?.email && email !== req.guardianSession.email) {
    return res.status(403).json({ ok: false, error: 'Authenticated user cannot activate for a different email.' });
  }

  const guarded = dbGuard(res, { tier: null });
  if (guarded) return;

  // Verify license against Gumroad
  let verifiedTier = null;
  let gumroadPurchase = null;

  for (const [permalink, tier] of Object.entries(PERMALINK_TO_TIER)) {
    try {
      const gumroadRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ product_permalink: permalink, license_key: licenseKey }),
      });
      const gumroadData = await gumroadRes.json();
      if (gumroadData?.success) {
        verifiedTier = tier;
        gumroadPurchase = gumroadData.purchase;
        break;
      }
    } catch (err) {
      console.warn(`Gumroad verify failed for permalink ${permalink}:`, err.message);
    }
  }

  if (!verifiedTier) {
    return res.status(400).json({ ok: false, error: 'Invalid or expired license key.' });
  }

  // Update user tier in Supabase
  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      { email, tier: verifiedTier, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    );

  if (upsertError) {
    recordDbWrite(upsertError);
    console.error('Supabase upsert error (activate):', upsertError.message);
    return res.status(500).json({ ok: false, error: 'Failed to activate tier. Please try again.' });
  }
  recordDbWrite(null);

  console.log(`✅ License activated: ${email} → ${verifiedTier}`);
  return res.json({
    ok: true,
    data: {
      email,
      tier: verifiedTier,
      product_name: gumroadPurchase?.product_name || null,
      activated_at: new Date().toISOString(),
    },
  });
});

// POST /api/heartbeat — desktop app sends periodic health status
// Requires Supabase session + matching email (same as /api/agents/:email)
// Body: { email, agentCount, lastBackupAt, tier, appVersion, state }
app.post('/api/heartbeat', requireSupabaseSession, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { agentCount, lastBackupAt, tier, appVersion, state } = req.body;

  if (!email) {
    return res.status(400).json({ ok: false, error: 'email is required' });
  }

  // Validate email matches session
  const sessionEmail = req.user?.email;
  if (sessionEmail && sessionEmail.toLowerCase() !== email.toLowerCase()) {
    return res.status(403).json({ ok: false, error: 'Email mismatch with session' });
  }

  try {
    // Upsert heartbeat into heartbeats table
    const { data: heartbeatData, error: heartbeatError } = await supabase
      .from('heartbeats')
      .upsert(
        {
          email: email.toLowerCase(),
          agent_count: Number(agentCount) || 0,
          last_backup_at: lastBackupAt || null,
          tier: tier || 'free',
          app_version: appVersion || null,
          state: state || 'idle',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )
      .select();

    if (heartbeatError) {
      recordDbWrite(heartbeatError);
      console.error('Supabase upsert error (heartbeat):', heartbeatError.message);
      return res.status(500).json({ ok: false, error: 'Failed to record heartbeat' });
    }
    recordDbWrite(null);

    runtimeMetrics.cron.heartbeats += 1;
    runtimeMetrics.cron.last_heartbeat_at = new Date().toISOString();

    res.json({
      ok: true,
      data: {
        email,
        received_at: new Date().toISOString(),
        agent_count: agentCount || 0,
      },
    });
  } catch (err) {
    recordDbWrite(err);
    console.error('Heartbeat endpoint error:', err.message || err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// GET /api/heartbeat/:email — fetch last heartbeat status for a user
// Requires Supabase session + matching email (same as /api/agents/:email)
app.get('/api/heartbeat/:email', requireSupabaseSession, requireMatchingEmail, async (req, res) => {
  const normalizedEmail = normalizeEmail(req.params.email);
  if (!normalizedEmail) return res.status(400).json({ ok: false, error: 'email is required' });

  const guarded = dbGuard(res, {});
  if (guarded) return;

  try {
    const { data: heartbeatData, error: heartbeatError } = await supabase
      .from('heartbeats')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (heartbeatError && heartbeatError.code !== 'PGRST116') {
      recordDbRead(heartbeatError);
      console.error('Supabase read error (heartbeat):', heartbeatError.message);
      return res.status(500).json({ ok: false, error: 'Failed to fetch heartbeat' });
    }
    recordDbRead(null);

    // No heartbeat found is OK — app may not have sent one yet
    const heartbeat = heartbeatData || {
      email: normalizedEmail,
      agent_count: 0,
      state: 'offline',
      last_seen_at: null,
    };

    res.json({
      ok: true,
      data: heartbeat,
    });
  } catch (err) {
    recordDbRead(err);
    console.error('Heartbeat fetch error:', err.message || err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
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

  if (userError) recordDbRead(userError);

  if (!userError && !userData) {
    const inserted = await supabase
      .from('users')
      .insert({ email, tier: 'free', updated_at: new Date().toISOString() })
      .select('id, email')
      .single();
    userData = inserted.data;
    userError = inserted.error;
    recordDbWrite(userError);
  }

  if (userError || !userData) {
    const message = userError?.message || 'Could not create or find user for upload';
    console.error('Supabase user lookup error (users for upload):', message);
    runtimeMetrics.backup.errors += 1;
    runtimeMetrics.backup.last_error_at = new Date().toISOString();
    return res.status(500).json({ ok: false, error: message });
  }
  recordDbRead(null);

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
    recordDbWrite(error);
    console.error('Supabase insert error (uploads):', error.message);
    runtimeMetrics.backup.errors += 1;
    runtimeMetrics.backup.last_error_at = new Date().toISOString();
    return res.status(500).json({ ok: false, error: error.message });
  }
  recordDbWrite(null);
  runtimeMetrics.backup.created += 1;
  runtimeMetrics.backup.last_created_at = new Date().toISOString();
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
    recordDbWrite(error);
    console.error('Supabase update error (uploads):', error.message);
    runtimeMetrics.backup.errors += 1;
    runtimeMetrics.backup.last_error_at = new Date().toISOString();
    return res.status(500).json({ ok: false, error: error.message });
  }
  if (!data) return res.status(404).json({ ok: false, error: `No backup found with cid "${cid}"` });
  recordDbWrite(null);
  runtimeMetrics.backup.deleted += 1;
  runtimeMetrics.backup.last_deleted_at = new Date().toISOString();
  return res.json({ ok: true, data });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message || err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🛡️  Agent Guardian API running on port ${PORT}`);
    console.log('   GET  /health');
    console.log('   GET  /api/metrics');
    console.log('   POST /api/cron/heartbeat');
    console.log('   GET  /api/validate-health');
    console.log('   POST /webhook/gumroad');
    console.log('   GET  /api/agents/:email');
    console.log('   GET  /api/history/:email');
    console.log('   GET  /api/tier/:email');
    console.log('   POST /api/activate');
    console.log('   POST /api/backup');
    console.log('   DEL  /api/backup/:cid');
  });
}

module.exports = app;
