import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { syncEngine } from '../sync/engine.js';

/**
 * One-time initial alignment for a hybrid node.
 *   npm run sync:bootstrap -- pull_all   # new local server for a school that already uses Atlas
 *   npm run sync:bootstrap -- push_all   # school started locally; copy everything up to an empty Atlas DB
 * Refuses when the destination already contains school data.
 */
async function main() {
  if (env.APP_MODE !== 'hybrid') throw new Error('Set APP_MODE=hybrid with ATLAS_SYNC_URI / ATLAS_SYNC_DB_NAME first.');
  const direction = process.argv[2];
  if (direction !== 'pull_all' && direction !== 'push_all') throw new Error('Usage: npm run sync:bootstrap -- pull_all|push_all');
  await connectDatabase();
  const copied = await syncEngine.bootstrap(direction);
  console.log(`Bootstrap ${direction} complete:`, copied);
  await syncEngine.stop();
}

main().then(disconnectDatabase).catch(async (e) => { console.error(e.message); await syncEngine.stop(); await disconnectDatabase(); process.exit(1); });
