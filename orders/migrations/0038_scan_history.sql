-- Scan audit trail. Every scan-relevant action (lookup, miss, bind, unbind,
-- adjust, create, OFF enrichment, conflict) lands here so inventory changes
-- are traceable to a code + actor + timestamp.
-- Logging is best-effort: a failed INSERT never blocks the scan flow.

CREATE TABLE IF NOT EXISTS scan_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id TEXT,                       -- NULL when no item was involved (miss / enrich)
  code         TEXT NOT NULL,              -- sanitized code that was scanned (or bound)
  action       TEXT NOT NULL,              -- lookup|miss|bind|unbind|adjust|create|conflict|enrich_off|enrich_off_miss|enrich_off_failed|enrich_off_skipped
  delta        REAL,                       -- quantity delta for 'adjust', else NULL
  actor        TEXT,                       -- Cloudflare Access email (cf-access-authenticated-user-email)
  source       TEXT NOT NULL DEFAULT 'manual', -- camera|gun|manual|system|stocktake
  meta         TEXT,                       -- JSON: { offProduct, conflict, reason, … }
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_events_inventory ON scan_events(inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_created   ON scan_events(created_at DESC);
