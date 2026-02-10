import { getApiConfig } from '../services/api/src/config.js';
import { openDb, migrate } from '../services/api/src/db.js';
import {
  createUser,
  createWorkspace,
  createWorkspaceMembership,
  listWorkspaces
} from '../services/api/src/taskService.js';
import { setUserPassword } from '../services/api/src/authService.js';

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function bootstrapOwnerAuth() {
  const config = getApiConfig();
  const login = normalizeEmail(
    process.argv[2] || process.env.BRIANHUB_OWNER_LOGIN || config.ownerSuperAdminEmail
  );
  const password = String(process.argv[3] || process.env.BRIANHUB_OWNER_PASSWORD || '').trim();
  const displayName = String(
    process.argv[4] || process.env.BRIANHUB_OWNER_DISPLAY_NAME || 'Brian Jason'
  ).trim() || 'Brian Jason';

  if (!login) {
    throw new Error('Owner login email is required.');
  }
  if (!password) {
    throw new Error(
      'Owner password is required. Usage: node scripts/bootstrap-owner-auth.js <email> <password> [displayName]'
    );
  }

  const db = await openDb({ filename: config.dbPath });
  try {
    await migrate(db, config.migrationsDir);
    const workspaces = await listWorkspaces(db);
    let workspace = workspaces.find((item) => !Number(item.archived)) ?? null;
    if (!workspace) {
      workspace = await createWorkspace(db, {
        name: 'Personal',
        type: 'personal'
      });
    }

    const user = await createUser(db, {
      org_id: workspace.org_id,
      workspace_id: workspace.id,
      display_name: displayName,
      email: login
    });

    await createWorkspaceMembership(db, {
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'owner'
    });

    await setUserPassword(db, { userId: user.id, password });

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        login,
        display_name: displayName,
        workspace_id: workspace.id,
        user_id: user.id
      }, null, 2)}\n`
    );
  } finally {
    await db.close();
  }
}

bootstrapOwnerAuth().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
