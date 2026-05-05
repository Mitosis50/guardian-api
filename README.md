# 🛡️ Agent Guardian API

Railway-ready Node.js + Express backend for the Agent Guardian system.  
Handles Gumroad purchase webhooks, user tier management, and agent backup tracking — all backed by Supabase.

---

## 📁 Project Structure

```
guardian-api/
├── server.js        # Express app + all route handlers
├── db.js            # Supabase client (graceful null-guard)
├── package.json     # Node dependencies
├── railway.json     # Railway deployment config
├── .env.example     # Environment variable template
└── README.md        # This file
```

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# → Edit .env and fill in SUPABASE_URL, SUPABASE_ANON_KEY, etc.

# 3. Start the server
npm start
# → API available at http://localhost:3001
```

> **No credentials?** The server starts fine with empty env vars — all Supabase calls return empty data with a warning instead of crashing.

---

## 🌐 API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ status: 'ok' }` |
| `POST` | `/webhook/gumroad` | Gumroad sale webhook — upserts user + tier |
| `GET` | `/api/agents/:email` | List all (non-deleted) backups for a user |
| `GET` | `/api/tier/:email` | Return the tier for a given email |
| `POST` | `/api/backup` | Create a new backup record |
| `DELETE` | `/api/backup/:cid` | Soft-delete a backup by CID |

---

## 📦 Route Details

### `POST /webhook/gumroad`
Gumroad sends `application/x-www-form-urlencoded` on every sale.

**Permalink → Tier mapping:**
| Permalink | Tier |
|-----------|------|
| `befbcx` | free |
| `ninnii` | guardian |
| `cjpizc` | pro |
| `ugmpm` | lifetime |

**Upserts** the `users` table on `email` conflict and logs the sale to a `sales` table.

---

### `GET /api/agents/:email`
Returns all non-deleted uploads for the given email.

```json
{ "ok": true, "data": [ { "cid": "...", "filename": "...", "size": 1024, "encrypted": true, ... } ] }
```

---

### `GET /api/tier/:email`
```json
{ "ok": true, "data": { "email": "user@example.com", "tier": "pro", "updated_at": "..." } }
```

---

### `POST /api/backup`
**Body (JSON):**
```json
{ "email": "user@example.com", "cid": "Qm...", "filename": "agent.zip", "size": 2048, "encrypted": true }
```
Returns the created record with HTTP 201.

---

### `DELETE /api/backup/:cid`
Soft-deletes the backup (sets `deleted=true`, `deleted_at` timestamp). The record remains in the DB for audit purposes.

---

## 🗄️ Supabase Schema

Run these SQL statements in your Supabase project to create the required tables:

```sql
-- Users table
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  tier        text not null default 'free',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Uploads / agent backups table
create table if not exists uploads (
  id          uuid primary key default gen_random_uuid(),
  email       text not null references users(email) on delete cascade,
  cid         text not null,
  filename    text not null,
  size        bigint,
  encrypted   boolean default false,
  deleted     boolean default false,
  deleted_at  timestamptz,
  created_at  timestamptz default now()
);

-- Sales audit log
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  permalink   text,
  tier        text,
  sale_id     text,
  seller_id   text,
  created_at  timestamptz default now()
);

-- Index for fast email lookups
create index if not exists uploads_email_idx on uploads (email);
create index if not exists uploads_cid_idx   on uploads (cid);
```

---

## ☁️ Deploy to Railway

1. Push this repo to GitHub.
2. Create a new Railway project → **Deploy from GitHub repo**.
3. In the Railway project dashboard, go to **Variables** and set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` *(preferred for trusted server reads/writes and session validation)*
   - `SUPABASE_ANON_KEY` *(fallback only; RLS may block server writes)*
   - `ALLOWED_ORIGINS=https://agentbotguardian.com,https://www.agentbotguardian.com`
   - `GUMROAD_SECRET` *(optional — for future HMAC verification)*
   - `PORT` is set automatically by Railway.
4. Railway detects `railway.json` and uses NIXPACKS to build + `node server.js` to start.
5. Copy the generated Railway domain and paste it into Gumroad → **Settings → Ping** (e.g. `https://your-app.up.railway.app/webhook/gumroad`).

---

## 🔐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes (for DB/auth) | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Trusted server key for reads/writes and Supabase JWT validation |
| `SUPABASE_ANON_KEY` | Fallback | Public anon key; useful for auth validation but may be blocked by RLS for DB writes |
| `ALLOWED_ORIGINS` / `CORS_ORIGIN` | Yes in production | Comma-separated allowed dashboard origins |
| `CLIENT_AUTH` | Yes in production for writes | Bearer token for desktop app write/heartbeat routes |
| `GUMROAD_SECRET` | Recommended | Shared secret for Gumroad webhook requests |
| `PORT` | No | HTTP port (default: 3001) |

---

## 🛠️ Development

```bash
# Live-reload dev mode (Node 18+)
npm run dev
```

---

*Built for Agent Guardian — © 2026*
