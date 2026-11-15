/* Boots a disposable test installation for Playwright: in-memory MongoDB + seeded DEMO school. */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
Object.assign(process.env, {
  NODE_ENV: 'development', APP_MODE: 'local', PORT: '8099', HOST: '127.0.0.1', APP_URL: 'http://127.0.0.1:8099',
  SCHOOL_INSTALL_ID: 'e2e-school', NODE_ID: 'e2e-local', PACKAGE: 'standard',
  MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: 'sms_e2e', SESSION_SECRET: 'c'.repeat(64), DATA_ENCRYPTION_KEY: 'd'.repeat(64),
  COOKIE_SECURE: 'false', LOGIN_RATE_LIMIT: '1000', LOG_LEVEL: 'warn', UPLOAD_DIR: './.test-data/e2e-uploads', BACKUP_DIR: './.test-data/e2e-backups',
  CLIENT_DIST: './client/dist'
});

const { connectDatabase } = await import('../../server/src/config/db.js');
const { createVersioned } = await import('../../server/src/services/repo.js');
const m = await import('../../server/src/models/index.js');
const { hashPassword } = await import('../../server/src/security/crypto.js');
const { normalizeName } = await import('../../shared/src/index.js');

await connectDatabase();
const pw = await hashPassword('E2e-Password-1');
await createVersioned(m.SchoolSettings, { _id: 'school', installId: 'e2e-school', name: 'DEMO E2E School', timeZone: 'Asia/Karachi', policy: { workingDays: [0, 1, 2, 3, 4, 5, 6], cutoffTime: null, allowBackdatedDays: 7 } });
const session = await createVersioned(m.AcademicSession, { name: '2026-2027', startDate: '2026-04-01', endDate: '2027-03-31', isDefault: true });
await m.SchoolSettings.updateOne({ _id: 'school' }, { defaultSessionId: session._id });
await createVersioned(m.User, { username: 'principal', fullName: 'DEMO Principal', role: 'principal', passwordHash: pw });
const teacher = await createVersioned(m.User, { username: 'teacher', fullName: 'DEMO Teacher', role: 'teacher', passwordHash: pw });
const cls = await createVersioned(m.SchoolClass, { name: 'DEMO Grade 5', order: 5 });
const sec = await createVersioned(m.Section, { classId: cls._id, name: 'A' });
const room = await createVersioned(m.Classroom, { classId: cls._id, sectionId: sec._id, sessionId: session._id, name: 'DEMO 5-A' });
await createVersioned(m.TeacherAssignment, { teacherId: teacher._id, classroomId: room._id, startedAt: new Date() });
for (const [i, n] of ['DEMO Ali', 'DEMO Sara', 'DEMO Omar', 'DEMO Hira'].entries()) {
  await createVersioned(m.Student, { admissionNumber: `E2E-${i}`, admissionNumberLower: `e2e-${i}`, fullName: n, nameNormalized: normalizeName(n), classroomId: room._id, classId: cls._id, sectionId: sec._id, sessionId: session._id, status: 'active' });
}
await import('../../server/src/index.js');
