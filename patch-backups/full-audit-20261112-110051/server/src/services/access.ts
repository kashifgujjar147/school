import type { SessionUser } from '@sms/shared';
import { TeacherAssignment } from '../models/index.js';
import { forbidden } from '../utils/http.js';

export async function teacherClassroomIds(userId: string): Promise<string[]> {
  return (await TeacherAssignment.find({ teacherId: userId, endedAt: null, deletedAt: null }).select('classroomId').lean()).map((a) => a.classroomId);
}

/** Users with attendance.view_all see every classroom; everyone else only assigned ones. */
export async function assertClassroomAccess(user: SessionUser, classroomId: string): Promise<void> {
  if (user.permissions.includes('attendance.view_all')) return;
  const ids = await teacherClassroomIds(user.id);
  if (!ids.includes(classroomId)) throw forbidden('You are not assigned to this classroom');
}

export async function classroomScopeFilter(user: SessionUser): Promise<{ classroomId?: { $in: string[] } }> {
  if (user.permissions.includes('attendance.view_all')) return {};
  return { classroomId: { $in: await teacherClassroomIds(user.id) } };
}
