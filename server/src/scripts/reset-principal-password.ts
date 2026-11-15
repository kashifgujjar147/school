import { passwordSchema } from '@sms/shared';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/index.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { updateVersioned } from '../services/repo.js';

async function main() {
  await connectDatabase();

  const user = await User.findOne({
    username: 'principal',
    role: 'principal',
    deletedAt: null
  });

  if (!user) {
    throw new Error('Principal account not found. No changes made.');
  }

  const password = generatePassword();
  const check = passwordSchema.safeParse(password);

  if (!check.success) {
    throw new Error('Generated password did not pass password validation.');
  }

  await updateVersioned(User, String(user._id), {
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
    mustChangePassword: false,
    failedLogins: 0,
    lockedUntil: null
  });

  console.log('\n==========================================');
  console.log(' PRINCIPAL PASSWORD RESET SUCCESSFUL');
  console.log(' Username: principal');
  console.log(` New Password: ${password}`);
  console.log(' Save this password securely.');
  console.log('==========================================\n');
}

main()
  .then(disconnectDatabase)
  .catch(async (error) => {
    console.error('Password reset failed:', error.message);
    await disconnectDatabase();
    process.exitCode = 1;
  });
