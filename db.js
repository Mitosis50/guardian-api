// db.js — Supabase client (gracefully handles missing credentials)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
// Server-side must use service role key to bypass RLS for webhook writes
// NEVER expose this key on the frontend
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon (⚠️ RLS may block writes)';
  console.log(`✅ Supabase client initialized with ${keyType} key`);
} else {
  console.warn('⚠️  WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. ' +
    'All database operations will return empty data until credentials are provided.');
}

module.exports = supabase;
