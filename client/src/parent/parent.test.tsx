import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuth } from '../store/auth';
import { homeFor } from '../pages/Auth';
import ParentHome from './ParentHome';
import PaymentStatus from './PaymentStatus';
import Verify from '../pages/Verify';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: { code: 'X', message: 'x' }, data }), { status, headers: { 'Content-Type': 'application/json' } });

function renderAt(path: string, route: string, el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'p1', username: 'mum', fullName: 'Mum', role: 'parent', permissions: ['parent.portal'], mustChangePassword: false }, offlineSession: false, config: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('routing helpers', () => {
  it('each account type lands in its own area', () => {
    expect(homeFor('parent')).toBe('/parent');
    expect(homeFor('teacher')).toBe('/teacher');
    expect(homeFor('principal')).toBe('/admin');
    expect(homeFor(undefined)).toBe('/admin');
  });
});

describe('parent dashboard', () => {
  it('renders every linked child with real figures from the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      today: '2026-11-13',
      children: [
        { _id: 'a', fullName: 'Ali Khan', admissionNumber: 'A-1', status: 'active', classroomId: 'r', classroomName: '5-A', className: 'Grade 5', sectionName: 'A', sessionName: '2026',
          attendance: { present: 18, absent: 2, late: 0, leave: 0, total: 20, percent: 90 }, latestResult: { examId: 'e', name: 'Mid-term', percent: 85, grade: 'A', passed: true },
          fees: { outstandingMinor: 550000, currency: 'PKR', overdue: 1, nextDue: null }, homework: [{ _id: 'h', subject: 'Maths', title: 'Page 12', dueDate: '2026-11-14' }] },
        { _id: 'b', fullName: 'Sara Khan', admissionNumber: 'A-2', status: 'active', classroomId: 'r', classroomName: '5-A', className: 'Grade 5', sectionName: 'A', sessionName: '2026',
          attendance: { present: 0, absent: 0, late: 0, leave: 0, total: 0, percent: null }, latestResult: null,
          fees: { outstandingMinor: 0, currency: 'PKR', overdue: 0, nextDue: null }, homework: [] }
      ],
      announcements: [{ _id: 'n', title: 'Sports day', body: 'Friday', publishedAt: '2026-11-12T10:00:00Z', pinned: false }],
      notifications: [], events: []
    }));
    renderAt('/parent', '/parent', <ParentHome />);
    const ali = (await screen.findByRole('heading', { name: 'Ali Khan' })).closest('article')!;
    expect(within(ali).getByText('90%')).toBeInTheDocument();
    expect(within(ali).getByText(/Mid-term/)).toBeInTheDocument();
    expect(within(ali).getByText(/1 overdue/)).toBeInTheDocument();
    expect(within(ali).getByText(/Page 12/)).toBeInTheDocument();
    expect(within(ali).getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/parent/children/a');
    expect(screen.getByRole('heading', { name: 'Sara Khan' })).toBeInTheDocument();
    expect(screen.getByText('Sports day')).toBeInTheDocument();
  });

  it('explains when no children are linked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ today: '2026-11-13', children: [], announcements: [], notifications: [], events: [] }));
    renderAt('/parent', '/parent', <ParentHome />);
    expect(await screen.findByText(/No children are linked/)).toBeInTheDocument();
  });

  it('shows an error state when the server fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(null, 500));
    renderAt('/parent', '/parent', <ParentHome />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('payment return page', () => {
  it('never claims success until the server reports a verified payment', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ intentId: 'i', status: 'pending', amountMinor: 550000, currency: 'pkr', voucher: { _id: 'v', voucherNumber: 'FV-1', title: 'Tuition', studentId: 'a', status: 'unpaid' }, receipt: null }));
    renderAt('/parent/payments/i?result=return', '/parent/payments/:intentId', <PaymentStatus />);
    expect(await screen.findByText(/not received confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/parent/payments/i', expect.anything());
  });

  it('shows the receipt once verified', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ intentId: 'i', status: 'succeeded', amountMinor: 550000, currency: 'pkr', voucher: { _id: 'v', voucherNumber: 'FV-1', title: 'Tuition', studentId: 'a', status: 'paid' }, receipt: { _id: 'r', receiptNumber: 'RC-261113-ABCDEF', amountMinor: 550000, paidAt: '2026-11-13T10:00:00Z' } }));
    renderAt('/parent/payments/i', '/parent/payments/:intentId', <PaymentStatus />);
    expect(await screen.findByText('Payment confirmed. Thank you!')).toBeInTheDocument();
    expect(screen.getByText('RC-261113-ABCDEF')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to fees' })).toHaveAttribute('href', '/parent/children/a?tab=fees');
  });
});

describe('ID card verification page', () => {
  it('valid card: shows only name, class and enrolment', async () => {
    useAuth.setState({ user: null });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ valid: true, schoolName: 'Test School', student: { fullName: 'Ali Khan', className: 'Grade 5 · A', enrolled: true }, issuedAt: '2026-11-01T00:00:00Z' }));
    renderAt('/verify/tok', '/verify/:token', <Verify />);
    expect(await screen.findByText('Valid student ID card')).toBeInTheDocument();
    expect(screen.getByText('Ali Khan')).toBeInTheDocument();
    expect(screen.getByText('Grade 5 · A')).toBeInTheDocument();
  });

  it('unknown card: clear failure', async () => {
    useAuth.setState({ user: null });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ valid: false, schoolName: 'Test School' }, 404));
    renderAt('/verify/bad', '/verify/:token', <Verify />);
    await waitFor(() => expect(screen.getByText('This card could not be verified.')).toBeInTheDocument());
  });
});
