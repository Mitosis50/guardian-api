// server.js — Agent Guardian Express API
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a Gumroad product permalink to an Agent Guardian tier name.
 * Returns null for unknown permalinks.
 */
const PERMALINK_TO_TIER = {
  befbcx: 'free',
  ninnii: 'guardian',
  cjpizc: 'pro',
  ugmpm:  'lifetime',
};

/**
 * Extracts the permalink slug from the Gumroad webhook body.
 * Gumroad may send "product_permalink" or "permalink", and the value
 * may be just the slug ("ninnii") OR a full URL ("https://cellular84.gumroad.com/l/ninnii").
 */
function extractPermalink(body) {
  const raw = String(body.product_permalink || body.permalink || '').trim().toLowerCase();
  // Check if it is a full URL — extract the last path segment
  if (raw.includes('/l/')) {
    const slug = raw.split('/l/').pop().split('?')[0].split('/')[0];
    return slug;
  }
  return raw;
}

function dbGuard(res, emptyPayload = null) {
  if (!supabase) {
    console.warn('⚠️  Supabase client is not initialised — returning empty data.');
    return res.json({ ok: true, data: emptyPayload, warning: 'No database credentials configured.' });
  }
  return null; // caller should proceed
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Gumroad Webhook ──────────────────────────────────────────────────────────
// POST /webhook/gumroad
// Gumroad sends an application/x-www-form-urlencoded POST on every sale.
// IMPORTANT: Always respond 200 IMMEDIATELY — Gumroad retries on any other code or timeout.
app.post('/webhook/gumroad', async (req, res) => {
  // Acknowledge immediately — never let Gumroad time out
  res.json({ ok: true });

  try {
    // URL-encoded forms send '+' as space — normalize email before use
    const email = String(req.body.email || '').replace(/\s/g, '+').trim().toLowerCase();
    const sale_id = req.body.sale_id;
    const seller_id = req.body.seller_id;
    const permalink = extractPermalink(req.body);

    // Basic validation — log and bail silently (already responded 200)
    if (!email || !permalink) {
      console.warn('Gumroad webhook missing email or permalink. Body:', JSON.stringify(req.body));
      return;
    }

    const tier = PERMALINK_TO_TIER[permalink];
    if (!tier) {
      console.warn(`Unknown Gumroad permalink received: "${permalink}"`);
      return;
    }

    console.log(`Gumroad sale: email=${email} permalink=${permalink} → tier=${tier} sale_id=${sale_id}`);

    // Short-circuit if no DB
    if (!supabase) {
      console.warn('Supabase not configured — skipping DB write.');
      return;
    }

    // Upsert user record
    const { data: userData, error: userError } = await supabase
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

    // Log the sale (sales table — created by migration script)
    const { error: saleError } = await supabase.from('sales').insert({
      email,
      permalink,
      tier,
      sale_id: sale_id || null,
      seller_id: seller_id || null,
      created_at: new Date().toISOString(),
    });

    if (saleError) {
      // Non-fatal: sales table may not exist yet — log but don't crash
      console.warn('Could not insert into sales table (non-fatal):', saleError.message);
    }

    console.log(`✅ Tier activated: ${email} → ${tier}`);
  } catch (err) {
    console.error('Unexpected error in /webhook/gumroad:', err);
  }
});

// ─── Agent Backups ────────────────────────────────────────────────────────────
// GET /api/agents/:email — list all (non-deleted) backups for a user
app.get('/api/agents/:email', async (req, res) => {
  const { email } = req.params;
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });

  const guarded = dbGuard(res, []);
  if (guarded) return;

  const { data, error } = await supabase
    .from('uploads')
    .select('*')
    .eq('email', email)
    .eq('deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase select error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.json({ ok: true, data: data || [] });
});

// ─── Tier Lookup ──────────────────────────────────────────────────────────────
// GET /api/tier/:email — return user tier
app.get('/api/tier/:email', async (req, res) => {
  const { email } = req.params;
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });

  const guarded = dbGuard(res, { tier: null });
  if (guarded) return;

  const { data, error } = await supabase
    .from('users')
    .select('email, tier, updated_at')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('Supabase select error (users):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: 'User not found' });
  }

  return res.json({ ok: true, data });
});

// ─── Create Backup ────────────────────────────────────────────────────────────
// POST /api/backup — insert a new backup record
// Body: { email, cid, filename, size, encrypted }
app.post('/api/backup', async (req, res) => {
  const { email, cid, filename, size, encrypted } = req.body;

  if (!email || !cid || !filename) {
    return res.status(400).json({ ok: false, error: 'Required fields: email, cid, filename' });
  }

  const guarded = dbGuard(res, { email, cid });
  if (guarded) return;

  const record = {
    email,
    cid,
    filename,
    size_bytes: size !== undefined ? Number(size) : null,  // ← FIX: was "size", schema uses "size_bytes"
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

// ─── Soft-Delete Backup ───────────────────────────────────────────────────────
// DELETE /api/backup/:cid — mark a backup as deleted
app.delete('/api/backup/:cid', async (req, res) => {
  const { cid } = req.params;
  if (!cid) return res.status(400).json({ ok: false, error: 'cid is required' });

  const guarded = dbGuard(res, { cid });
  if (guarded) return;

  const { data, error } = await supabase
    .from('uploads')
    .update({ deleted: true, deleted_at: new Date().toISOString() })
    .eq('cid', cid)
    .select()
    .single();

  if (error) {
    console.error('Supabase update error (uploads):', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: `No backup found with cid "${cid}"` });
  }

  return res.json({ ok: true, data });
});

// ─── 404 Catch-All ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🛡️  Agent Guardian API running on port ${PORT}`);
  console.log(`   GET  /health`);
  console.log(`   POST /webhook/gumroad`);
  console.log(`   GET  /api/agents/:email`);
  console.log(`   GET  /api/tier/:email`);
  console.log(`   POST /api/backup`);
  console.log(`   DEL  /api/backup/:cid`);
});

module.exports = app;
