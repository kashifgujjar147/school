import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, X, XCircle } from 'lucide-react';
import { useT } from '../i18n';
import { ApiError, NetworkError, QueuedOfflineError } from '../services/api';

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
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-line px-5 py-4 sm:px-6">
          {title && <h2 className="text-[0.9375rem] font-semibold tracking-[-0.005em] text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-5 sm:p-6')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-surface-line pb-5">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-accent">{eyebrow}</p>}
        <h1 className="font-serif text-[1.85rem] font-semibold leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.15rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}
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
      {hint && !error && <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>}
      {error && <FieldError id={`${fid}-e`}>{error}</FieldError>}
    </div>
  );
});

function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="mt-1.5 flex animate-fade-in items-start gap-1.5 text-xs font-medium text-red-700"><XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{children}</p>;
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { options: { value: string; label: string }[]; placeholder?: string }>(function Select({ label, error, hint, className, options, placeholder, id, ...p }, ref) {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <select id={fid} ref={ref} className={clsx('input select', error && 'border-red-400')} aria-invalid={Boolean(error)} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && !error && <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, error, hint, className, id, ...p }, ref) {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <textarea id={fid} ref={ref} rows={3} className={clsx('input py-2.5', error && 'border-red-400')} aria-invalid={Boolean(error)} {...p} />
      {hint && !error && <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
});

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-surface-line accent-[rgb(var(--brand))] focus:ring-brand/30 disabled:cursor-not-allowed" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const tone = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-700/15', red: 'bg-red-50 text-red-800 ring-red-700/15',
  amber: 'bg-amber-50 text-amber-900 ring-amber-700/20', blue: 'bg-sky-50 text-sky-800 ring-sky-700/15',
  gray: 'bg-stone-100 text-stone-700 ring-stone-600/15', violet: 'bg-violet-50 text-violet-800 ring-violet-700/15'
};
const dot = { green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500', gray: 'bg-stone-400', violet: 'bg-violet-500' };
export type Tone = keyof typeof tone;
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: Tone }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', tone[color])}>
      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', dot[color])} aria-hidden />{children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  present: 'green', absent: 'red', late: 'amber', leave: 'blue', active: 'green', archived: 'gray', transferred: 'violet', graduated: 'blue', suspended: 'red',
  inactive: 'gray', pending: 'amber', approved: 'green', rejected: 'red', delivered: 'green', sent: 'blue', failed: 'red', dead: 'red', undelivered: 'red',
  blocked_config: 'amber', processing: 'blue', cancelled: 'gray', synced: 'green', conflict: 'red', verified: 'green', completed: 'blue', running: 'blue', verify_failed: 'red',
  ok: 'green', degraded: 'amber', down: 'red', not_configured: 'amber', disabled: 'gray',
  unpaid: 'red', partial: 'amber', paid: 'green', succeeded: 'green', expired: 'gray', amount_mismatch: 'red', created: 'gray'
};

/** Content-shaped placeholder while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/** Page / panel loading state: skeleton rows that mirror the layout instead of a lone spinner. */
export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="animate-fade-in space-y-3 px-1 py-6" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-faint"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{label ?? t('loading')}</div>
      <Skeleton className="h-9 w-2/5" />
      <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" />
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
      <div className="mb-1 rounded-2xl border border-surface-line bg-surface-muted p-3.5 text-ink-faint [&>svg]:h-6 [&>svg]:w-6">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="font-serif text-xl font-semibold text-ink">{title ?? t('noData')}</p>
      {children && <div className="max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof QueuedOfflineError) return e.message;
  if (e instanceof NetworkError) return 'The school server cannot be reached. Check the connection.';
  if (e instanceof ApiError) return e.message;
  return fallback;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex animate-fade-in flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <div className="rounded-2xl bg-red-50 p-3 text-red-600 ring-1 ring-inset ring-red-700/10"><XCircle className="h-6 w-6" /></div>
      <p className="text-sm text-ink">{errorMessage(error, t('errorGeneric'))}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t('retry')}</Button>}
    </div>
  );
}

export function Alert({ kind = 'info', children, title }: { kind?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode; title?: ReactNode }) {
  const styles = { info: 'border-sky-200/80 bg-sky-50/80 text-sky-950 [--bar:theme(colors.sky.500)]', success: 'border-emerald-200/80 bg-emerald-50/80 text-emerald-950 [--bar:theme(colors.emerald.500)]', warning: 'border-amber-200/90 bg-amber-50/80 text-amber-950 [--bar:theme(colors.amber.500)]', error: 'border-red-200/80 bg-red-50/80 text-red-950 [--bar:theme(colors.red.500)]' };
  const icon = { info: 'text-sky-600', success: 'text-emerald-600', warning: 'text-amber-600', error: 'text-red-600' };
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }[kind];
  return (
    <div className={clsx('relative flex animate-fade-in gap-3 overflow-hidden rounded-xl border py-3 pe-4 ps-4 text-sm leading-relaxed before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-[var(--bar)]', styles[kind])} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', icon[kind])} />
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
  // Portal to <body>: a dialog opened inside a blurred / transformed container (sticky header, animated
  // page) must still cover the whole screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-night/45 p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('max-h-[92vh] w-full animate-sheet-up overflow-y-auto rounded-t-3xl bg-white shadow-overlay sm:animate-pop-in sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-surface-line bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
          <h3 id={titleId} className="min-w-0 flex-1 truncate font-serif text-xl font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-xl p-2 text-ink-faint transition hover:bg-surface-muted hover:text-ink" aria-label={t('close')}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-surface-line bg-surface-muted/90 px-5 py-4 backdrop-blur sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
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
  const ring = { green: 'text-emerald-700 bg-emerald-50 ring-emerald-700/10', red: 'text-red-700 bg-red-50 ring-red-700/10', amber: 'text-amber-700 bg-amber-50 ring-amber-700/10', blue: 'text-sky-700 bg-sky-50 ring-sky-700/10', gray: 'text-brand bg-brand-soft ring-brand/10', violet: 'text-violet-700 bg-violet-50 ring-violet-700/10' }[tn];
  return (
    <div className="card card-interactive group relative flex items-start justify-between gap-3 overflow-hidden p-4 sm:gap-4 sm:p-6">
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="num mt-2.5 text-[1.6rem] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[2rem]">{value}</p>
        {hint && <p className="mt-2.5 text-xs text-ink-soft">{hint}</p>}
      </div>
      {icon && <div className={clsx('hidden shrink-0 rounded-xl p-2.5 ring-1 ring-inset min-[400px]:block transition duration-300 ease-lux group-hover:scale-105', ring)}>{icon}</div>}
      <span className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-accent transition-transform duration-500 ease-lux group-hover:scale-x-100 rtl:origin-right" aria-hidden />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-line bg-surface-muted/40 px-4 py-3 text-sm text-ink-soft sm:px-5">
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
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-surface-line bg-surface-sunken/60 p-1" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.value} role="tab" aria-selected={tb.value === value} onClick={() => onChange(tb.value)}
          className={clsx('whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition duration-200 ease-lux', tb.value === value ? 'bg-white text-ink shadow-raised' : 'text-ink-soft hover:bg-white/50 hover:text-ink')}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="table-base">{children}</table></div>;
}

/** Shared chart styling (Recharts): soft hairline grid, muted axes, refined tooltip. */
export const chartTooltip = {
  contentStyle: { borderRadius: 12, border: '1px solid #e6e3dc', boxShadow: '0 12px 32px -12px rgb(15 27 45 / 0.25)', fontSize: 12, padding: '8px 12px' },
  labelStyle: { color: '#0f1b2d', fontWeight: 600, marginBottom: 4 },
  cursor: { fill: 'rgb(15 27 45 / 0.04)', stroke: 'rgb(15 27 45 / 0.12)' }
} as const;
export const CHART = { grid: '#ebe8e1', tick: '#8b94a5', absent: '#b9382f', late: '#d29a2c', leave: '#3b6fa0', present: '#2f7a5b' } as const;
