import { useState, type ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '@sms/shared';
import { useT } from '../i18n';
import { Alert, Badge, Button, Modal, Textarea, errorMessage } from './ui';
import { useFormat } from '../i18n';

/**
 * Free WhatsApp (click-to-chat, https://wa.me): opens the parent's chat with the message typed.
 * Browsers allow one new window per click and WhatsApp needs Send pressed in the app, so there is
 * no API, no cost and no risk to the school's number.
 */
export function openWhatsapp(digits: string, message: string) {
  window.open(whatsappLink(digits, message), '_blank', 'noopener');
}

export const WA_GREEN = '!bg-[#1f9d55] hover:!bg-[#178246] !text-white';

export function SentBadge({ at }: { at: string | null }) {
  const t = useT(); const f = useFormat();
  if (!at) return <span className="text-ink-faint">{t('waNotSent')}</span>;
  if (new Date(at).toDateString() === new Date().toDateString()) return <Badge color="green">{t('waSentToday')}</Badge>;
  return <span className="text-ink-soft">{t('waSentOn', { date: f.date(at) })}</span>;
}

export interface QueueItem { key: string; name: string; phone: string | null; detail: ReactNode; whatsapp: string | null; message: string }

/** "WhatsApp all parents": one parent at a time; each press opens the next chat. */
export function WhatsappQueue({ title, items, onSent, onClose }: { title: string; items: QueueItem[]; onSent: (key: string) => void; onClose: () => void }) {
  const t = useT();
  const queue = items.filter((x) => x.whatsapp);
  const skipped = items.length - queue.length;
  const [i, setI] = useState(0);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const r = queue[i];
  const open = () => {
    if (!r?.whatsapp) return;
    openWhatsapp(r.whatsapp, r.message);
    onSent(r.key);
    setOpened((s) => new Set(s).add(r.key));
  };
  return (
    <Modal open onClose={onClose} title={title} wide>
      {i >= queue.length ? (
        <div className="space-y-4">
          <Alert kind="success">{t('waDone', { n: opened.size })}</Alert>
          {skipped > 0 && <Alert kind="warning">{t('waSkippedNoPhone', { n: skipped })}</Alert>}
          <div className="flex justify-end"><Button onClick={onClose}>{t('close')}</Button></div>
        </div>
      ) : r && (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">{t('waHowItWorks')}</p>
          <div>
            <div className="mb-1.5 flex justify-between text-sm font-medium"><span>{t('waStep', { i: i + 1, n: queue.length })}</span><span className="num text-ink-faint">{Math.round((i / queue.length) * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${(i / queue.length) * 100}%` }} /></div>
          </div>
          <div className="rounded-2xl border border-surface-line p-4">
            <p className="text-lg font-semibold">{r.name || r.phone} <span className="num text-sm font-normal text-ink-faint">· {r.phone}</span></p>
            <div className="text-ink-soft">{r.detail}</div>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#e7f6ec] p-3 font-sans text-sm text-ink">{r.message}</pre>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {skipped > 0 && <span className="me-auto text-xs text-amber-700">{t('waSkippedNoPhone', { n: skipped })}</span>}
            <Button variant="ghost" onClick={() => setI(i + 1)}>{t('waSkip')}</Button>
            {opened.has(r.key)
              ? <Button onClick={() => setI(i + 1)}>{t('waNext')} →</Button>
              : <Button className={WA_GREEN} onClick={open}><MessageCircle className="h-4 w-4" />{t('waOpenChat')}</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export interface TemplateField { key: string; label: string; value: string | null; defaultValue: string; preview?: (tpl: string) => string }

/** Edits one or more message templates; saving the default wording stores null (= keep using the default). */
export function TemplateEditor({ title, help, fields, onSave, onClose }: { title: string; help: string; fields: TemplateField[]; onSave: (values: Record<string, string | null>) => Promise<unknown>; onClose: (saved: boolean) => void }) {
  const t = useT();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value || f.defaultValue])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await onSave(Object.fromEntries(fields.map((f) => [f.key, vals[f.key]!.trim() === f.defaultValue.trim() ? null : vals[f.key]!])));
      onClose(true);
    } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} title={title} wide
      footer={<><Button variant="ghost" className="me-auto" onClick={() => setVals(Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])))}>{t('waResetDefault')}</Button><Button variant="secondary" onClick={() => onClose(false)}>{t('cancel')}</Button><Button loading={busy} disabled={fields.some((f) => !vals[f.key]?.trim())} onClick={() => void save()}>{t('save')}</Button></>}>
      <div className="space-y-5">
        {err && <Alert kind="error">{err}</Alert>}
        <p className="text-sm text-ink-soft">{help}</p>
        {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Textarea label={f.label} rows={8} maxLength={1000} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            {f.preview && <div><p className="label">{t('waPreview')}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#e7f6ec] p-3 font-sans text-sm">{f.preview(vals[f.key] ?? '')}</pre></div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
