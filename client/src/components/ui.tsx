import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, X, XCircle } from 'lucide-react';
import { useT } from '../i18n';
import { ApiError, NetworkError } from '../services/api';

export function Button({ variant = 'primary', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean }) {
  return (
    <button className={clsx(`btn-${variant}`, className)} disabled={loading || p.disabled} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-line px-5 py-4">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type FieldProps = { label?: ReactNode; error?: string; hint?: ReactNode; className?: string };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({ label, error, hint, className, id, ...p }, ref) {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <input id={fid} ref={ref} className={clsx('input', error && 'border-red-400')} aria-invalid={Boolean(error)} aria-describedby={error ? `${fid}-e` : undefined} {...p} />
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && <p id={`${fid}-e`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { options: { value: string; label: string }[]; placeholder?: string }>(function Select({ label, error, hint, className, options, placeholder, id, ...p }, ref) {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <select id={fid} ref={ref} className={clsx('input', error && 'border-red-400')} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, error, hint, className, id, ...p }, ref) {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <textarea id={fid} ref={ref} rows={3} className={clsx('input', error && 'border-red-400')} {...p} />
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
});

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" className="h-4 w-4 rounded border-surface-line text-brand focus:ring-brand/30" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const tone = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20', blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20', violet: 'bg-violet-50 text-violet-700 ring-violet-600/20'
};
export type Tone = keyof typeof tone;
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: Tone }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', tone[color])}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  present: 'green', absent: 'red', late: 'amber', leave: 'blue', active: 'green', archived: 'gray', transferred: 'violet', graduated: 'blue', suspended: 'red',
  inactive: 'gray', pending: 'amber', approved: 'green', rejected: 'red', delivered: 'green', sent: 'blue', failed: 'red', dead: 'red', undelivered: 'red',
  blocked_config: 'amber', processing: 'blue', cancelled: 'gray', synced: 'green', conflict: 'red', verified: 'green', completed: 'blue', running: 'blue', verify_failed: 'red',
  ok: 'green', degraded: 'amber', down: 'red', not_configured: 'amber', disabled: 'gray',
  unpaid: 'red', partial: 'amber', paid: 'green', succeeded: 'green', expired: 'gray', amount_mismatch: 'red', created: 'gray'
};

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label ?? t('loading')}</div>;
}

export function EmptyState({ title, children, icon }: { title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="rounded-full bg-surface-muted p-3 text-ink-faint">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-medium text-ink">{title ?? t('noData')}</p>
      {children && <div className="max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof NetworkError) return 'The school server cannot be reached. Check the connection.';
  if (e instanceof ApiError) return e.message;
  return fallback;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <XCircle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-ink">{errorMessage(error, t('errorGeneric'))}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t('retry')}</Button>}
    </div>
  );
}

export function Alert({ kind = 'info', children, title }: { kind?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode; title?: ReactNode }) {
  const styles = { info: 'border-sky-200 bg-sky-50 text-sky-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-900' };
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }[kind];
  return (
    <div className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', styles[kind])} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{title && <p className="font-medium">{title}</p>}<div>{children}</div></div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const titleId = useId();
  // Callers pass inline onClose functions (new on every render). Keep the latest in a ref so the
  // focus effect below runs only when the dialog opens: otherwise every keystroke in a field whose
  // state lives in the parent re-ran it and threw focus back to the first field.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-line bg-white px-5 py-4">
          <h3 id={titleId} className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted" aria-label={t('close')}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-surface-line bg-white px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, loading, onConfirm, onCancel, children }: { open: boolean; title: ReactNode; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void; children?: ReactNode }) {
  const t = useT();
  return (
    <Modal open={open} onClose={onCancel} title={title} footer={<><Button variant="secondary" onClick={onCancel}>{t('cancel')}</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel ?? t('confirm')}</Button></>}>
      <div className="space-y-4 text-sm text-ink-soft">{message}{children}</div>
    </Modal>
  );
}

export function StatCard({ label, value, hint, icon, tone: tn = 'gray' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  const ring = { green: 'text-emerald-600 bg-emerald-50', red: 'text-red-600 bg-red-50', amber: 'text-amber-600 bg-amber-50', blue: 'text-sky-600 bg-sky-50', gray: 'text-brand bg-brand-soft', violet: 'text-violet-600 bg-violet-50' }[tn];
  return (
    <div className="card flex items-start gap-4 p-5">
      {icon && <div className={clsx('rounded-xl p-2.5', ring)}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="num mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-surface-line px-4 py-3 text-sm text-ink-soft">
      <span>{t('totalItems', { total })}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('previous')}</Button>
        <span className="num">{t('pageOf', { page, pages })}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('next')}</Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.value} role="tab" aria-selected={tb.value === value} onClick={() => onChange(tb.value)}
          className={clsx('whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition', tb.value === value ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink')}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="table-base">{children}</table></div>;
}
