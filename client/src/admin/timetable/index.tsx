import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { EmptyState, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { useSessions } from '../shared';
import { useL } from '../../timetable/common';
import BoardTab from './Board';
import SetupTab from './Setup';
import ResourcesTab from './Resources';
import RequirementsTab from './Requirements';
import TeachersTab from './Teachers';
import SubstitutesTab from './Substitutes';

type Tab = 'board' | 'setup' | 'resources' | 'requirements' | 'teachers' | 'substitutes';

/** Timetable Management (principal / admin): set-up, generation, editing, publishing and substitutes. */
export default function TimetableAdmin() {
  const L = useL();
  const can = useAuth((s) => s.can);
  const sessions = useSessions();
  const [params, setParams] = useSearchParams();
  const [sessionId, setSessionId] = useState('');
  useEffect(() => {
    if (!sessionId && sessions.data?.data.length) setSessionId(sessions.data.data.find((s) => s.isDefault)?._id ?? sessions.data.data[0]!._id);
  }, [sessions.data, sessionId]);
  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: 'board', label: L('Timetable', 'ٹائم ٹیبل'), show: true },
    { value: 'setup', label: L('School timings', 'اسکول اوقات'), show: true },
    { value: 'resources', label: L('Subjects & rooms', 'مضامین اور کمرے'), show: true },
    { value: 'requirements', label: L('Weekly periods', 'ہفتہ وار پیریڈ'), show: true },
    { value: 'teachers', label: L('Teachers', 'اساتذہ'), show: true },
    { value: 'substitutes', label: L('Substitutes', 'متبادل اساتذہ'), show: can('substitutes.manage') || can('timetable.view') }
  ];
  const visible = tabs.filter((t) => t.show);
  const tab = (visible.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'board') as Tab;
  const readOnly = !can('timetable.manage');
  if (sessions.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={L('Timetable', 'ٹائم ٹیبل')} subtitle={L('Periods, weekly requirements, automatic generation, editing, publishing and substitutes.', 'پیریڈ، ہفتہ وار ضروریات، خودکار تیاری، ترمیم، اشاعت اور متبادل اساتذہ۔')}
        actions={<div className="no-print w-56"><Select aria-label={L('Academic session', 'تعلیمی سیشن')} value={sessionId} onChange={(e) => setSessionId(e.target.value)} options={(sessions.data?.data ?? []).map((s) => ({ value: s._id, label: `${s.name}${s.isDefault ? ` (${L('current', 'موجودہ')})` : ''}` }))} /></div>} />
      <div className="no-print"><Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} tabs={visible.map((t) => ({ value: t.value, label: t.label }))} /></div>
      {!sessionId ? <EmptyState title={L('No academic session', 'کوئی تعلیمی سیشن نہیں')}>{L('Create an academic session under Classrooms first.', 'پہلے کلاس رومز میں تعلیمی سیشن بنائیں۔')}</EmptyState> : (
        <div className="mt-4">
          {tab === 'board' && <BoardTab sessionId={sessionId} readOnly={readOnly} canPublish={can('timetable.publish')} />}
          {tab === 'setup' && <SetupTab sessionId={sessionId} readOnly={readOnly} />}
          {tab === 'resources' && <ResourcesTab sessionId={sessionId} readOnly={readOnly} />}
          {tab === 'requirements' && <RequirementsTab sessionId={sessionId} readOnly={readOnly} />}
          {tab === 'teachers' && <TeachersTab sessionId={sessionId} readOnly={readOnly} />}
          {tab === 'substitutes' && <SubstitutesTab sessionId={sessionId} readOnly={!can('substitutes.manage')} />}
        </div>
      )}
    </div>
  );
}
