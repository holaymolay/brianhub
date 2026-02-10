-- Store client mutation ids to make sync push idempotent for replayed requests.
CREATE TABLE IF NOT EXISTS sync_mutations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT,
  client_mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_mutations_workspace_client_mutation
  ON sync_mutations(workspace_id, client_mutation_id);

CREATE INDEX IF NOT EXISTS idx_sync_mutations_workspace_created
  ON sync_mutations(workspace_id, created_at);

