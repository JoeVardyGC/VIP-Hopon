// Deletes the local demo database (data/pg) so the next start re-seeds it.
// Ticket signing keys are stored in the database, so they are recreated too (old tickets stop scanning).
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL is set: this script only clears the local database. Use the Neon console to reset an online database.');
  process.exit(1);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
rmSync(join(dir, process.env.HOPON_DB || 'pg'), { recursive: true, force: true });
console.log('Local demo data cleared. Start the app to re-seed.');
