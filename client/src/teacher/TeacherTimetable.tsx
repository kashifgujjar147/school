import { useState } from 'react';
import { teachingPeriodsForDay, type DatePlan, type TimetableConfigShape } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { DayList, NoticeList, PrintButton, ViewToggle, WeekGrid, subjectColor, useDayName, useL, useViewMode, type GridLesson, type Notice } from '../timetable/common';

interface My {
  configured: boolean; published: boolean; publishedAt: string | null; config: TimetableConfigShape | null;
  lessons: { _id: string; day: number; periodKey: string; classroom: string; subject: string; subjectColor: string | null; room: string | null }[];
  covering: { _id: string; date: string; periodKey: string; classroom: string; subject: string; room: string | null; forTeacher: string | null }[];
  coveredBy: { _id: string; date: string; periodKey: string; entryId: string; classroom: string; subject: string; substitute: string | null }[];
  notices: Notice[]; plans: DatePlan[];
}

/** The signed-in teacher's own published timetable, free periods, covers and notices. */
export default function TeacherTimetable() {
  const L = useL(); const dayName = useDayName();
  const [mode, setMode] = useViewMode();
  const [dateIdx, setDateIdx] = useState(0);
  const q = useGet<My>('/api/timetable/my');
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  const header = <PageHeader title={L('My timetable', 'میرا ٹائم ٹیبل')} subtitle={d.publishedAt ? `${L('Published', 'شائع شدہ')} ${new Date(d.publishedAt).toLocaleString()}` : undefined} actions={<PrintButton label={L('Print', 'پرنٹ')} />} />;
  if (!d.config || !d.published) {
    return <div>{header}<Card><EmptyState title={L('No timetable yet', 'ابھی ٹائم ٹیبل نہیں')}>{L('Your timetable appears here once the school publishes it.', 'اسکول کے شائع کرنے کے بعد آپ کا ٹائم ٹیبل یہاں نظر آئے گا۔')}</EmptyState></Card><div className="mt-4"><NoticeList title={L('Notices', 'اطلاعات')} notices={d.notices} empty={L('No notices.', 'کوئی اطلاع نہیں۔')} /></div></div>;
  }
  const cfg = d.config;
  const coverOf = (l: { _id: string; day: number }) => d.coveredBy.find((c) => c.entryId === l._id && d.plans.find((p) => p.date === c.date)?.day === l.day);
  const lessons: GridLesson[] = [
    ...d.lessons.map((l) => {
      const c = coverOf(l);
      return { id: l._id, day: l.day, periodKey: l.periodKey, title: l.classroom, color: subjectColor(l.subject, l.subjectColor), lines: [l.subject, l.room ? `${L('Room', 'کمرہ')}: ${l.room}` : ''],
        badge: c ? `${c.date.slice(5)}: ${L('covered by', 'متبادل')} ${c.substitute ?? ''}` : null };
    }),
    ...d.covering.map((c) => {
      const day = d.plans.find((p) => p.date === c.date)?.day ?? -1;
      return { id: c._id, day, periodKey: c.periodKey, title: c.classroom, color: '#7c3aed', lines: [c.subject, c.forTeacher ? `${L('for', 'بجائے')} ${c.forTeacher}` : ''], badge: `${L('Cover', 'متبادل')} ${c.date.slice(5)}` };
    })
  ];
  const teachingSlots = cfg.workingDays.reduce((a, day) => a + teachingPeriodsForDay(cfg, day).length, 0);
  const plan = d.plans[dateIdx];
  const dayLessons: GridLesson[] = plan ? [
    ...d.lessons.filter((l) => l.day === plan.day).map((l) => {
      const c = d.coveredBy.find((x) => x.entryId === l._id && x.date === plan.date);
      return { id: l._id, day: l.day, periodKey: l.periodKey, title: `${l.classroom} · ${l.subject}`, color: subjectColor(l.subject, l.subjectColor), lines: [l.room ? `${L('Room', 'کمرہ')}: ${l.room}` : '', c ? `${L('Covered by', 'متبادل استاد')}: ${c.substitute ?? ''}` : ''], muted: Boolean(c), badge: c ? L('Covered', 'متبادل') : null };
    }),
    ...d.covering.filter((c) => c.date === plan.date).map((c) => ({ id: c._id, day: plan.day, periodKey: c.periodKey, title: `${c.classroom} · ${c.subject}`, color: '#7c3aed', lines: [c.room ? `${L('Room', 'کمرہ')}: ${c.room}` : '', c.forTeacher ? `${L('Covering for', 'بجائے')} ${c.forTeacher}` : ''], badge: L('Substitution', 'متبادل') }))
  ] : [];
  const freeToday = plan && !plan.closed ? plan.periods.filter((p) => p.kind === 'teaching' && !dayLessons.some((l) => l.periodKey === p.key && !l.muted)).length : 0;
  return (
    <div className="space-y-4">
      <CacheNotice fromCache={q.data.fromCache} />
      {header}
      <div className="no-print grid gap-3 sm:grid-cols-3">
        <StatCard label={L('Lessons per week', 'ہفتہ وار پیریڈ')} value={d.lessons.length} />
        <StatCard label={L('Free periods per week', 'ہفتہ وار خالی پیریڈ')} value={Math.max(0, teachingSlots - d.lessons.length)} />
        <StatCard label={L('Covering (next 2 weeks)', 'متبادل (اگلے 2 ہفتے)')} value={d.covering.length} tone={d.covering.length ? 'violet' : 'gray'} />
      </div>
      <div className="no-print flex justify-end"><ViewToggle mode={mode} onChange={setMode} week={L('Week', 'ہفتہ')} day={L('Day', 'دن')} /></div>
      {mode === 'week' ? (
        <WeekGrid config={cfg} lessons={lessons} today={d.plans[0]?.day ?? null} plans={d.plans.filter((p) => cfg.workingDays.includes(p.day))} freeLabel={L('Free', 'خالی')} />
      ) : (
        <Card>
          <div className="no-print mb-3 flex flex-wrap gap-1" role="tablist">
            {d.plans.map((p, i) => (
              <button key={p.date} type="button" role="tab" aria-selected={i === dateIdx} onClick={() => setDateIdx(i)} className={`rounded-lg px-3 py-1.5 text-sm ${i === dateIdx ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted'}`}>
                {i === 0 ? L('Today', 'آج') : dayName(p.day, true)} <span className="num text-[11px] opacity-80">{p.date.slice(5)}</span>
              </button>
            ))}
          </div>
          {plan && !plan.closed && <p className="mb-2 text-sm text-ink-soft">{L('Free periods', 'خالی پیریڈ')}: <span className="num font-semibold text-ink">{freeToday}</span>{plan.label ? ` · ${plan.label}` : ''}</p>}
          {plan && <DayList periods={plan.periods} lessons={dayLessons} closedLabel={plan.closed ? (plan.label ?? L('No school on this day', 'اس دن اسکول بند ہے')) : null} freeLabel={L('Free period', 'خالی پیریڈ')} />}
        </Card>
      )}
      <NoticeList title={L('Notices', 'اطلاعات')} notices={d.notices} empty={L('No notices.', 'کوئی اطلاع نہیں۔')} />
    </div>
  );
}
