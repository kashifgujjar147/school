import { passwordSchema } from '@sms/shared';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/index.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { updateVersioned } from '../services/repo.js';

async function main() {
  await connectDatabase();

  const users = await User.find({
    username: 'principal',
    role: 'principal',
    deletedAt: null
  });

  if (users.length !== 1) {
    throw new Error(
      `Expected exactly one principal account; found ${users.length}. No changes made.`
    );
  }

  const user = users[0];
  const password = generatePassword();
  const check = passwordSchema.safeParse(password);

  if (!check.success) {
    throw new Error('Generated password failed validation. No changes made.');
  }

  await updateVersioned(User, String(user._id), {
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
    mustChangePassword: true,
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
  .catch((error) => {
    console.error('Password reset failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
