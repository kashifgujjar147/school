import { useGet } from '../hooks/useApi';
import { ErrorState, PageHeader, Spinner } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { ClassTimetableView, type ClassTimetablePayload } from '../timetable/ClassTimetableView';
import { useL } from '../timetable/common';

interface Me { fullName: string; admissionNumber: string; classroomName: string; className: string; sectionName: string; sessionName: string }

/** Student portal: the student's own class timetable (published only) and timetable notices. */
export default function StudentHome() {
  const L = useL();
  const me = useGet<Me>('/api/student/me');
  const tt = useGet<ClassTimetablePayload>('/api/student/timetable');
  if (me.isLoading || tt.isLoading) return <Spinner />;
  if (me.isError || !me.data) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (tt.isError || !tt.data) return <ErrorState error={tt.error} onRetry={() => tt.refetch()} />;
  const s = me.data.data;
  return (
    <div>
      <CacheNotice fromCache={tt.data.fromCache} />
      <PageHeader title={L('My class timetable', 'میری کلاس کا ٹائم ٹیبل')} subtitle={<span className="num">{s.fullName} · {[s.className, s.sectionName].filter(Boolean).join(' · ')} · {s.admissionNumber}{s.sessionName ? ` · ${s.sessionName}` : ''}</span>} />
      <ClassTimetableView data={tt.data.data} />
    </div>
  );
}
