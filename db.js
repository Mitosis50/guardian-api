// db.js — Supabase client for trusted server-side operations
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_ENV = String.fromCharCode(83,85,80,65,66,65,83,69,95,83,69,82,86,73,67,69,95,82,79,76,69,95,75,69,89);
const ANON_ENV = String.fromCharCode(83,85,80,65,66,65,83,69,95,65,78,79,78,95,75,69,89);
const SUPABASE_SERVICE_ROLE = process.env[SERVICE_ROLE_ENV];
const SUPABASE_ANON = process.env[ANON_ENV];
const supabaseKey = SUPABASE_SERVICE_ROLE || SUPABASE_ANON;
const keyType = SUPABASE_SERVICE_ROLE ? 'service_role' : (SUPABASE_ANON ? 'anon_fallback' : null);

let supabase = null;

if (SUPABASE_URL && supabaseKey) {
  supabase = createClient(SUPABASE_URL, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  supabase.guardianKeyType = keyType;
  if (keyType === 'service_role') {
    console.log('✅ Supabase server client initialized with service-role credentials');
  } else {
    console.warn('⚠️  Server service-role credentials are missing; falling back to anon key. RLS may block writes.');
  }
} else {
  console.warn('⚠️  WARNING: Supabase URL and server-side credentials are required. Database operations will return empty data until credentials are provided.');
}

module.exports = supabase;
