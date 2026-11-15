import { resolveApiUrl } from '../services/apiUrl';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { useT, useFormat } from '../i18n';
import { useAuth } from '../store/auth';
import { LangSwitch } from '../components/Layout';
import { Spinner } from '../components/ui';

interface Result { valid: boolean; schoolName: string; student?: { fullName: string; className: string; enrolled: boolean }; issuedAt?: string | null }

/**
 * Public page opened by scanning a student ID card. Shows only what the API discloses publicly:
 * school, student name, class and whether enrolment is current. No login required.
 */
export default function Verify() {
  const t = useT(); const f = useFormat();
  const { token = '' } = useParams();
  const config = useAuth((s) => s.config);
  const [state, setState] = useState<{ loading: boolean; data: Result | null; error: boolean }>({ loading: true, data: null, error: false });
  useEffect(() => {
    let cancelled = false;
    fetch(resolveApiUrl(`/api/public/verify/${encodeURIComponent(token)}`), { headers: { Accept: 'application/json' }, credentials: 'include' })
      .then(async (r) => { const j = await r.json().catch(() => null); if (!cancelled) setState({ loading: false, data: j?.data ?? null, error: !r.ok && r.status !== 404 }); })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [token]);
  const d = state.data;
  const genuine = Boolean(d?.student);
  const tone = d?.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : genuine ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900';
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-4 py-10">
      <div className="absolute end-4 top-4"><LangSwitch /></div>
      <div className="w-full max-w-sm">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          {config?.logoUrl ? <img src={config.logoUrl} alt="" className="h-14 w-14 rounded-2xl object-contain" /> : null}
          <h1 className="text-lg font-semibold">{d?.schoolName ?? config?.schoolName}</h1>
          <p className="text-sm text-ink-soft">{t('verifyTitle')}</p>
        </div>
        {state.loading ? <Spinner /> : (
          <div className={`rounded-2xl border p-6 text-center ${tone}`} role="status" aria-live="polite">
            {d?.valid ? <BadgeCheck className="mx-auto h-12 w-12" /> : genuine ? <ShieldAlert className="mx-auto h-12 w-12" /> : <ShieldX className="mx-auto h-12 w-12" />}
            <p className="mt-3 text-lg font-semibold">{d?.valid ? t('cardValid') : genuine ? t('cardNotEnrolled') : state.error ? t('errorGeneric') : t('cardInvalid')}</p>
            {d?.student && (
              <dl className="mt-4 space-y-2 text-start text-sm">
                <div className="flex justify-between gap-3"><dt className="opacity-75">{t('name')}</dt><dd className="font-medium">{d.student.fullName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="opacity-75">{t('class')}</dt><dd className="font-medium">{d.student.className || 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="opacity-75">{t('enrolled')}</dt><dd className="font-medium">{d.student.enrolled ? t('yes') : t('no')}</dd></div>
                {d.issuedAt && <div className="flex justify-between gap-3"><dt className="opacity-75">{t('cardIssued')}</dt><dd className="num font-medium">{f.date(d.issuedAt)}</dd></div>}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
