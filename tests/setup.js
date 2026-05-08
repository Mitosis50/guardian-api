/**
 * Jest setup — runs once before any test file is loaded.
 * Sets auth tokens and mocks the database to null so tests
 * run in pure unit mode (no real Supabase connection).
 */

'use strict'

// These map to the obfuscated env-var reads in server.js:
// API_CLIENT_TOKEN  and  GUMROAD_WEBHOOK_SECRET
process.env.API_CLIENT_TOKEN = 'test-client-token'
process.env.GUMROAD_WEBHOOK_SECRET = 'test-webhook-secret'
process.env.NODE_ENV = 'test'

// Prevent any accidental Supabase connection during tests.
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY
delete process.env.SUPABASE_ANON_KEY

// Mock db.js to return null (no database) for all test files.
jest.mock('../db', () => null)
