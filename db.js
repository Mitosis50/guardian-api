// db.js — Supabase client (gracefully handles missing credentials)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️  WARNING: SUPABASE_URL or SUPABASE_ANON_KEY is not set. ' +
    'All database operations will return empty data until credentials are provided.');
}

module.exports = supabase;
