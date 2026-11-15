import { useState } from 'react';
import type { DatePlan, TimetableConfigShape } from '@sms/shared';
import { Card, EmptyState } from '../components/ui';
import { DayList, NoticeList, PrintButton, ViewToggle, WeekGrid, subjectColor, useDayName, useL, useViewMode, type GridLesson, type Notice } from './common';

export interface ClassTimetablePayload {
  classroom: { _id: string; name: string; room: string | null };
  published: boolean; publishedAt: string | null;
  config: TimetableConfigShape | null;
  lessons: { _id: string; day: number; periodKey: string; subject: string; subjectColor: string | null; teacher: string | null; room: string | null }[];
  substitutions: { date: string; periodKey: string; entryId: string; teacher: string }[];
  plans: DatePlan[];
  notices: Notice[];
}

/** Read-only class timetable for the student and parent portals (published timetable only). */
export function ClassTimetableView({ data }: { data: ClassTimetablePayload }) {
  const L = useL(); const dayName = useDayName();
  const [mode, setMode] = useViewMode();
  const [dateIdx, setDateIdx] = useState(0);
  if (!data.config || !data.published) {
    return <Card><EmptyState title={L('No timetable yet', 'ابھی ٹائم ٹیبل نہیں')}>{L('The school has not published a timetable for this class yet.', 'اسکول نے ابھی اس کلاس کا ٹائم ٹیبل شائع نہیں کیا۔')}</EmptyState></Card>;
  }
  const cfg = data.config;
  // Covers in the coming week, matched to the lesson by its id and the weekday of the date.
  const subFor = (l: { _id: string; day: number }) => data.substitutions.find((s) => s.entryId === l._id && data.plans.find((p) => p.date === s.date)?.day === l.day);
  const lessons: GridLesson[] = data.lessons.map((l) => {
    const sub = subFor(l);
    return {
      id: l._id, day: l.day, periodKey: l.periodKey, title: l.subject, color: subjectColor(l.subject, l.subjectColor),
      lines: [l.teacher ?? '', l.room ? `${L('Room', 'کمرہ')}: ${l.room}` : ''],
      badge: sub ? `${L('Cover', 'متبادل')} ${sub.date.slice(5)}: ${sub.teacher}` : null
    };
  });
  const plan = data.plans[dateIdx];
  const todayDay = data.plans[0]?.day ?? null;
  const dayLessons: GridLesson[] = plan ? data.lessons.filter((l) => l.day === plan.day).map((l) => {
    const sub = data.substitutions.find((s) => s.entryId === l._id && s.date === plan.date);
    return { id: l._id, day: l.day, periodKey: l.periodKey, title: l.subject, color: subjectColor(l.subject, l.subjectColor),
      lines: [sub ? `${L('Substitute', 'متبادل استاد')}: ${sub.teacher}` : l.teacher ?? '', l.room ? `${L('Room', 'کمرہ')}: ${l.room}` : ''], badge: sub ? L('Substitute', 'متبادل') : null };
  }) : [];
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{data.classroom.name}{data.publishedAt ? ` · ${L('Updated', 'تازہ کاری')} ${new Date(data.publishedAt).toLocaleDateString()}` : ''}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle mode={mode} onChange={setMode} week={L('Week', 'ہفتہ')} day={L('Day', 'دن')} />
          <PrintButton label={L('Print', 'پرنٹ')} />
        </div>
      </div>
      {mode === 'week' ? (
        <WeekGrid config={cfg} lessons={lessons} today={todayDay} plans={data.plans.filter((p) => cfg.workingDays.includes(p.day))} freeLabel={L('Free', 'خالی')} />
      ) : (
        <Card>
          <div className="no-print mb-3 flex flex-wrap gap-1" role="tablist">
            {data.plans.map((p, i) => (
              <button key={p.date} type="button" role="tab" aria-selected={i === dateIdx} onClick={() => setDateIdx(i)}
                className={`rounded-lg px-3 py-1.5 text-sm ${i === dateIdx ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted'}`}>
                {i === 0 ? L('Today', 'آج') : dayName(p.day, true)} <span className="num text-[11px] opacity-80">{p.date.slice(5)}</span>
              </button>
            ))}
          </div>
          {plan && plan.label && !plan.closed && <p className="mb-2 text-sm font-medium text-violet-700">{plan.label}</p>}
          {plan && <DayList periods={plan.periods} lessons={dayLessons} closedLabel={plan.closed ? (plan.label ?? L('No school on this day', 'اس دن اسکول بند ہے')) : null} freeLabel={L('Free period', 'خالی پیریڈ')} />}
        </Card>
      )}
      <NoticeList title={L('Timetable notices', 'ٹائم ٹیبل اطلاعات')} notices={data.notices} empty={L('No timetable changes.', 'کوئی تبدیلی نہیں۔')} />
    </div>
  );
}
