import { passwordSchema } from '@sms/shared';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { SchoolSettings, User } from '../models/index.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { createVersioned } from '../services/repo.js';
import { initialiseSchoolData } from '../services/setup.js';

/**
 * First-run initialisation of ONE school's database:
 *   - stamps the database with SCHOOL_INSTALL_ID (isolation guard)
 *   - creates school settings, a default academic session, default SMS templates
 *   - creates the principal account with a strong generated password (printed once; signs in
 *     directly, changing it later from the dashboard is optional)
 * Refuses to run on a database that is already initialised.
 */
async function main() {
  await connectDatabase();
  const existing = await SchoolSettings.findById('school').lean();
  if (existing) {
    throw new Error(`Database "${env.MONGODB_DB_NAME}" is already initialised for installation "${existing.installId}". Nothing changed.`);
  }
  const name = process.env.INIT_SCHOOL_NAME || 'My School';
  await initialiseSchoolData({ name, timeZone: process.env.INIT_TIMEZONE || 'Asia/Karachi' });

  const username = (process.env.INIT_PRINCIPAL_USERNAME || 'principal').toLowerCase();
  let password = process.env.INIT_PRINCIPAL_PASSWORD || '';
  const generated = !password;
  if (generated) password = generatePassword();
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(`INIT_PRINCIPAL_PASSWORD is too weak: ${check.error.issues.map((i) => i.message).join(', ')}`);
  await createVersioned(User, {
    username, fullName: process.env.INIT_PRINCIPAL_NAME || 'Principal', role: 'principal',
    passwordHash: await hashPassword(password), mustChangePassword: false
  });


  console.log('\n========================================================');
  console.log(` School initialised: ${name}`);
  console.log(` Installation id:    ${env.SCHOOL_INSTALL_ID}`);
  console.log(` Database:           ${env.MONGODB_DB_NAME}`);
  console.log(` Principal username: ${username}`);
  if (generated) console.log(` Principal password: ${password}   <-- shown ONCE; store it safely (can be changed later in the dashboard)`);
  console.log('========================================================\n');
}

main().then(disconnectDatabase).catch(async (e) => { console.error('Initialisation failed:', e.message); await disconnectDatabase(); process.exit(1); });

