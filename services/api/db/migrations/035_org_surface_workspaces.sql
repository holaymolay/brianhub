PRAGMA foreign_keys = ON;

ALTER TABLE workspaces ADD COLUMN organization_id TEXT REFERENCES orgs(id);

CREATE INDEX IF NOT EXISTS idx_workspaces_organization_id ON workspaces(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_org_surface_unique
  ON workspaces(organization_id)
  WHERE organization_id IS NOT NULL;
