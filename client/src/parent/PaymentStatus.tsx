import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Download, XCircle } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { downloadFile } from '../services/api';
import { Alert, Button, Card, ErrorState, PageHeader, Spinner, errorMessage } from '../components/ui';
import { useMoney } from './common';

interface Status {
  intentId: string; status: string; amountMinor: number; currency: string;
  voucher: { _id: string; voucherNumber: string; title: string; studentId: string; status: string } | null;
  receipt: { _id: string; receiptNumber: string; amountMinor: number; paidAt: string } | null;
}

/**
 * Landing page after the provider's checkout. Coming back here proves nothing by itself: the
 * server re-checks the payment with the provider and shows "paid" only once it is verified.
 */
export default function PaymentStatus() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const { intentId = '' } = useParams();
  const [params] = useSearchParams();
  const cancelled = params.get('result') === 'cancelled';
  const [err, setErr] = useState<string | null>(null);
  const q = useGet<Status>(`/api/parent/payments/${intentId}`, { refetchInterval: (d) => (d && ['succeeded', 'failed', 'expired', 'amount_mismatch'].includes(d.data.status) ? false : 5000) });
  if (q.isLoading) return <Spinner label={t('paymentVerifying')} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  const done = d.status === 'succeeded';
  const failed = ['failed', 'expired', 'amount_mismatch'].includes(d.status);
  const icon = done ? <CheckCircle2 className="h-10 w-10 text-emerald-600" /> : failed ? <XCircle className="h-10 w-10 text-red-500" /> : <Clock className="h-10 w-10 animate-pulse text-amber-500" />;
  const message = done ? t('paymentSucceeded') : d.status === 'expired' ? t('paymentExpired') : d.status === 'amount_mismatch' ? t('paymentMismatch') : d.status === 'failed' ? t('paymentFailed') : cancelled ? t('paymentCancelled') : t('paymentPendingNote');
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t('payOnline')} />
      <Card>
        <div className="flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
          {icon}
          <p className="text-lg font-medium">{message}</p>
          {d.voucher && <p className="text-sm text-ink-soft">{d.voucher.title} · <span className="num">{d.voucher.voucherNumber}</span></p>}
          <p className="num text-2xl font-semibold">{money(d.amountMinor, d.currency)}</p>
          {d.receipt && <p className="text-sm text-ink-soft">{t('receiptNo')}: <span className="num">{d.receipt.receiptNumber}</span> · {f.dateTime(d.receipt.paidAt)}</p>}
          {err && <Alert kind="error">{err}</Alert>}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {d.receipt && <Button onClick={() => downloadFile(`/api/parent/receipts/${d.receipt!._id}/pdf`, `receipt-${d.receipt!.receiptNumber}.pdf`).catch((x) => setErr(errorMessage(x, t('errorGeneric'))))}><Download className="h-4 w-4" />{t('receipt')}</Button>}
            {d.voucher && <Link className="btn-secondary" to={`/parent/children/${d.voucher.studentId}?tab=fees`}>{t('backToFees')}</Link>}
          </div>
        </div>
      </Card>
    </div>
  );
}
