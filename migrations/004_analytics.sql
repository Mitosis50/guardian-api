-- Create analytics tracking tables
CREATE TABLE backup_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'backup_created', 'backup_deleted', 'restore_completed'
  backup_size_bytes BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE storage_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  total_backups INT NOT NULL DEFAULT 0,
  total_storage_bytes BIGINT NOT NULL DEFAULT 0,
  tier TEXT NOT NULL, -- 'free', 'guardian', 'pro', 'lifetime'
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE tier_conversions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  old_tier TEXT NOT NULL,
  new_tier TEXT NOT NULL,
  converted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast analytics queries
CREATE INDEX idx_backup_events_email ON backup_events(email);
CREATE INDEX idx_backup_events_created_at ON backup_events(created_at);
CREATE INDEX idx_storage_snapshots_email ON storage_snapshots(email);
CREATE INDEX idx_storage_snapshots_captured_at ON storage_snapshots(captured_at);
CREATE INDEX idx_tier_conversions_email ON tier_conversions(email);

-- Materialized view: Daily storage by tier
CREATE MATERIALIZED VIEW daily_storage_by_tier AS
SELECT
  DATE(captured_at) as date,
  tier,
  COUNT(DISTINCT email) as user_count,
  AVG(total_storage_bytes) as avg_storage_bytes,
  SUM(total_storage_bytes) as total_storage_bytes,
  AVG(total_backups) as avg_backup_count
FROM storage_snapshots
GROUP BY DATE(captured_at), tier;

-- Materialized view: Backup event aggregates
CREATE MATERIALIZED VIEW backup_event_summary AS
SELECT
  DATE(created_at) as date,
  event_type,
  COUNT(*) as event_count,
  COUNT(DISTINCT email) as unique_users,
  AVG(backup_size_bytes) as avg_size_bytes
FROM backup_events
GROUP BY DATE(created_at), event_type;
