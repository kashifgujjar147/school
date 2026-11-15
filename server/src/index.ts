import { networkInterfaces } from 'node:os';
import { env, APP_VERSION } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { assertInstallIdentity } from './services/settings.js';
import { initialiseSchoolData } from './services/setup.js';
import { SchoolSettings } from './models/index.js';
import { createApp } from './app.js';
import { workers } from './jobs/workers.js';
import { runMigrations } from './scripts/migrations.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDatabase();
  await assertInstallIdentity();
  if (!(await SchoolSettings.exists({ _id: 'school' }))) {
    if (!env.SETUP_TOKEN) {
      logger.error('This database has not been initialised. Run: npm run init:school (or set SETUP_TOKEN to use the web setup at /setup)');
      process.exit(2);
    }
    // Web setup enabled: create the school's base records (no accounts). The first administrator is
    // then created at /setup with the SETUP_TOKEN.
    await initialiseSchoolData({ name: process.env.INIT_SCHOOL_NAME, timeZone: process.env.INIT_TIMEZONE });
    logger.warn('Empty database initialised for web setup. Open /setup to create the first administrator.');
  }
  await runMigrations();
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ version: APP_VERSION, mode: env.APP_MODE, package: env.PACKAGE, port: env.PORT }, 'server started');
    if (env.APP_MODE !== 'cloud') {
      // Print LAN addresses so the principal can tell teachers which URL to open.
      const addrs = Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.family === 'IPv4' && !i!.internal).map((i) => `http://${i.address}:${env.PORT}`);
      logger.info({ lanUrls: addrs }, 'LAN access URLs');
    }
  });
  workers.start();
  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close();
    await workers.stop();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
