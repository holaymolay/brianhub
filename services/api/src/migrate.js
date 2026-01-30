import { openDb, migrate } from './db.js';

const db = await openDb();
migrate(db);
console.log('Migrations applied.');
