import { useGet } from '../hooks/useApi';
import { useT } from '../i18n';
import { ErrorState, PageHeader, Spinner } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { ClassTimetableView, type ClassTimetablePayload } from '../timetable/ClassTimetableView';
import { useL } from '../timetable/common';
import { Avatar } from '../parent/common';
import { AttendanceTab, FeesTab, HomeworkTab, ProfileTab, ResultsTab, type Profile } from '../parent/ChildDetail';

/**
 * Student portal pages. They reuse the parent portal's screens with the student's own API
 * (/api/student/*), which only ever returns the signed-in student's records.
 */
const BASE = '/api/student';

interface Me { fullName: string; admissionNumber: string; className: string; sectionName: string; sessionName: string }

function useMe() { return useGet<Me>(`${BASE}/me`); }
const placement = (s?: Me) => (s ? <span className="num">{[s.className, s.sectionName].filter(Boolean).join(' · ')} · {s.admissionNumber}{s.sessionName ? ` · ${s.sessionName}` : ''}</span> : undefined);

export function StudentTimetable() {
  const L = useL();
  const me = useMe();
  const tt = useGet<ClassTimetablePayload>(`${BASE}/timetable`);
  if (tt.isLoading) return <Spinner />;
  if (tt.isError || !tt.data) return <ErrorState error={tt.error} onRetry={() => tt.refetch()} />;
  return (
    <div>
      <CacheNotice fromCache={tt.data.fromCache} />
      <PageHeader title={L('My class timetable', 'میری کلاس کا ٹائم ٹیبل')} subtitle={placement(me.data?.data)} />
      <ClassTimetableView data={tt.data.data} />
    </div>
  );
}

export function StudentAttendance() {
  const t = useT(); const me = useMe();
  return <div><PageHeader title={t('navMyAttendance')} subtitle={placement(me.data?.data)} /><AttendanceTab base={BASE} /></div>;
}

export function StudentResults() {
  const t = useT(); const me = useMe();
  return <div><PageHeader title={t('navMyResults')} subtitle={placement(me.data?.data)} /><ResultsTab base={BASE} name={me.data?.data.fullName ?? 'student'} /></div>;
}

export function StudentHomework() {
  const t = useT(); const me = useMe();
  return <div><PageHeader title={t('navHomework')} subtitle={placement(me.data?.data)} /><HomeworkTab base={BASE} /></div>;
}

export function StudentFees() {
  const t = useT(); const L = useL();
  return (
    <div>
      <PageHeader title={t('navFees')} subtitle={L('Download vouchers and receipts. Payments are made by your parent or at the school office.', 'واؤچر اور رسیدیں ڈاؤن لوڈ کریں۔ ادائیگی والدین یا اسکول آفس کے ذریعے ہوتی ہے۔')} />
      <FeesTab base={BASE} docs={BASE} />
    </div>
  );
}

export function StudentProfile() {
  const t = useT();
  const q = useGet<Profile>(`${BASE}/profile`);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data.data;
  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={s.fullName} photo={s.photoPath} size="h-16 w-16" />
        <PageHeader title={s.fullName} subtitle={<span className="num">{[s.className, s.sectionName].filter(Boolean).join(' · ')} · {s.admissionNumber}</span>} eyebrow={t('navMyProfile')} />
      </div>
      <ProfileTab s={s} />
    </div>
  );
}
