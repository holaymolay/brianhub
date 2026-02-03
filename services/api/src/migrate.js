import { openDb, migrate } from './db.js';

const db = await openDb();
try {
  await migrate(db);
  // eslint-disable-next-line no-console
  console.log('Migrations applied.');
} finally {
  await db.close();
}
