'use client';
import { useEffect, useState } from 'react';

type Workers = { automationEnabled: boolean; payoutMode: 'AUTOMATIC' | 'MANUAL'; workers: { name: string; disabled?: boolean; failures?: number; lastCompletedAt?: string | null }[] };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const workerLabel: Record<string, string> = {
  payout: 'ارسال برداشت', 'submitted-payments': 'تأیید واریز', 'binary-settlement': 'باینری', investments: 'سود اینوست', auctions: 'مزایده',
};

/** One glance at what needs attention: automation, workers and queues. */
export function StatusStrip({ request, go, superAdmin }: { request: Request; go: (view: string) => void; superAdmin: boolean }) {
  const [workers, setWorkers] = useState<Workers | null>(null);
  const [queues, setQueues] = useState({ withdrawals: 0, payments: 0 }), [error, setError] = useState('');
  const load = async () => {
    try {
      const [w, withdrawals, payments] = await Promise.all([
        request<Workers>('/v1/admin/workers'),
        request<{ status: string }[]>('/v1/admin/withdrawals'), request<{ status: string }[]>('/v1/admin/payments'),
      ]);
      setWorkers(w); setError('');
      setQueues({ withdrawals: withdrawals.filter(row => ['REQUESTED', 'REVIEWING', 'APPROVED'].includes(row.status)).length, payments: payments.filter(row => row.status === 'PENDING').length });
    } catch (e) { setError(e instanceof Error ? e.message : 'وضعیت سیستم دریافت نشد.'); }
  };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, []);
  const failing = workers?.workers.filter(w => (w.failures ?? 0) > 0) ?? [];
  return <section className="admin-card status-strip" dir="rtl" aria-label="وضعیت سیستم">
    <h2>وضعیت سیستم</h2>
    {error && <p role="alert" className="status-error">{error}</p>}
    <div className="status-tiles">
      <button className={`status-tile ${queues.withdrawals ? 'warn' : 'ok'}`} onClick={() => go('finance')}><small>برداشت در انتظار</small><b>{queues.withdrawals}</b></button>
      <button className={`status-tile ${queues.payments ? 'warn' : 'ok'}`} onClick={() => go('finance')}><small>پرداخت در انتظار</small><b>{queues.payments}</b></button>
      <div className={`status-tile ${workers?.payoutMode === 'AUTOMATIC' ? 'ok' : 'warn'}`}><small>حالت برداشت</small><b>{workers ? (workers.payoutMode === 'AUTOMATIC' ? 'خودکار' : 'دستی') : '…'}</b></div>
      <div className={`status-tile ${workers?.automationEnabled ? 'ok' : 'warn'}`}><small>تأیید خودکار واریز</small><b>{workers ? (workers.automationEnabled ? 'روشن' : 'خاموش') : '…'}</b></div>
    </div>
    {failing.length > 0 && <p role="alert" className="status-error">سرویس‌های دارای خطا: {failing.map(w => `${workerLabel[w.name] ?? w.name} (${w.failures})`).join('، ')}. اگر خطا ادامه داشت، لاگ سرور را بررسی کنید.</p>}
  </section>;
}
