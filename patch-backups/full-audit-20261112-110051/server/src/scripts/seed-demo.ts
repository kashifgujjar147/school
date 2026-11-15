import { normalizeName } from '@sms/shared';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Classroom, Guardian, SchoolClass, SchoolSettings, Section, Student, StudentGuardian, TeacherAssignment, User } from '../models/index.js';
import { hashPassword } from '../security/crypto.js';
import { createVersioned } from '../services/repo.js';

/**
 * DEMO / SAMPLE DATA — for evaluation and training installs only.
 * Every record created here is prefixed "DEMO" so it can never be mistaken for real school data.
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=yes.
 */
async function main() {
  if (env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'yes') throw new Error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=yes to override).');
  await connectDatabase();
  const s = await SchoolSettings.findById('school').lean();
  if (!s?.defaultSessionId) throw new Error('Run init:school first.');
  if (await Student.exists({ admissionNumber: /^DEMO-/ })) throw new Error('Demo data already present.');

  const teacherPw = 'DemoTeacher2026';
  const teachers: { _id: string }[] = [];
  for (const [u, n] of [['demo.ayesha', 'DEMO Ayesha Khan'], ['demo.bilal', 'DEMO Bilal Ahmed']]) {
    teachers.push(await createVersioned(User, { username: u, fullName: n, role: 'teacher', passwordHash: await hashPassword(teacherPw), mustChangePassword: false }));
  }
  const names = ['Ali Raza', 'Fatima Noor', 'Hamza Iqbal', 'Zainab Ali', 'Usman Tariq', 'Maryam Siddiqui', 'Hassan Javed', 'Ayesha Malik', 'Omar Farooq', 'Hira Shah', 'Saad Qureshi', 'Iqra Butt'];
  let adm = 1;
  for (const [ci, className] of ['DEMO Grade 5', 'DEMO Grade 6'].entries()) {
    const cls = await createVersioned(SchoolClass, { name: className, order: ci });
    const sec = await createVersioned(Section, { classId: cls._id, name: 'A' });
    const room = await createVersioned(Classroom, { classId: cls._id, sectionId: sec._id, sessionId: s.defaultSessionId, name: `${className}-A` });
    await createVersioned(TeacherAssignment, { teacherId: teachers[ci]!._id, classroomId: room._id, isHomeroom: true, startedAt: new Date() });
    for (const n of names.slice(ci * 6, ci * 6 + 6)) {
      const full = `DEMO ${n}`;
      const st = await createVersioned(Student, {
        admissionNumber: `DEMO-${String(adm).padStart(4, '0')}`, admissionNumberLower: `demo-${String(adm).padStart(4, '0')}`,
        fullName: full, nameNormalized: normalizeName(full), classroomId: room._id, classId: cls._id, sectionId: sec._id, sessionId: s.defaultSessionId,
        status: 'active', gender: 'unspecified', admissionDate: '2026-04-01', primaryGuardianPhone: `+92300000${String(adm).padStart(4, '0')}`
      });
      const g = await createVersioned(Guardian, { fullName: `DEMO Guardian of ${n}`, relation: 'Parent', phone: `+92300000${String(adm).padStart(4, '0')}`, smsOptIn: true, language: 'en' });
      await createVersioned(StudentGuardian, { studentId: st._id, guardianId: g._id, isPrimary: true, receivesAlerts: true });
      adm++;
    }
  }
  console.log('DEMO / SAMPLE DATA created: 2 classrooms, 12 students, 2 teachers.');
  console.log(`Demo teacher logins: demo.ayesha / demo.bilal — password ${teacherPw}`);
  console.log('Demo guardian phone numbers are fake (+92300000xxxx). Do not enable SMS automation with demo data.');
}

main().then(disconnectDatabase).catch(async (e) => { console.error(e.message); await disconnectDatabase(); process.exit(1); });
