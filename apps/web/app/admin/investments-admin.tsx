'use client';
import { useEffect, useState } from 'react';

type Row = {
  id: string; planCode: string; principal: string; profitPaid: string; tokensPaid: string; valueConsumed: string; maxProfit: string; maxCap: string; profitLocked: string; profitReleasedAt: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'; startedAt: string; settledThrough: string | null; refundAmount: string | null; fixedCycles: number;
  cancellation: { eligible: boolean; deadline: string };
  user: { telegramId: string; username?: string | null; firstName?: string | null };
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const usd = (atomic: string) => (Number(atomic) / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 });
const statusFa = { ACTIVE: 'فعال', COMPLETED: 'تکمیل‌شده', CANCELLED: 'لغوشده' } as const;

export function InvestmentsAdmin({ request }: { request: Request }) {
  const [rows, setRows] = useState<Row[]>([]), [pool, setPool] = useState('0'), [error, setError] = useState(''), [filter, setFilter] = useState('');
  useEffect(() => {
    request<{ poolBalance: string; investments: Row[] }>('/v1/admin/investments')
      .then(result => { setRows(result.investments); setPool(result.poolBalance); })
      .catch(e => setError(e instanceof Error ? e.message : 'دریافت اینوست‌ها ناموفق بود.'));
  }, []);
  const active = rows.filter(row => row.status === 'ACTIVE');
  const sum = (items: Row[], key: 'principal' | 'profitPaid' | 'profitLocked') => items.reduce((total, row) => total + Number(row[key]), 0);
  const visible = rows.filter(row => !filter || `${row.user.username ?? ''} ${row.user.firstName ?? ''} ${row.user.telegramId}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="admin-card admin-wide" dir="rtl" id="investments">
    <span>اینوست پک‌ها</span>
    <h2>سرمایه‌گذاری کاربران</h2>
    <p>سود هر ماه اول ماه میلادی خودکار پرداخت می‌شود: سود USDT به موجودی قابل برداشت و توکن‌ها به GEN. ارزش هر توکن ۰٫۱۰ USDT است و سود + ارزش توکن از نوار Max Profit و Max Cap همان اینوست کم می‌شود. لغو تا ۲ ماه بعد از خرید توسط خود کاربر و خودکار انجام می‌شود.</p>
    {error && <p role="alert">{error}</p>}
    <div className="admin-stats">
      <div><small>اینوست فعال</small><b>{active.length}</b></div>
      <div><small>اصل سرمایه‌ی فعال</small><b>{usd(String(sum(active, 'principal')))} USDT</b></div>
      <div><small>سود محاسبه‌شده (کل)</small><b>{usd(String(sum(rows, 'profitPaid')))} USDT</b></div>
      <div><small>سود قفل‌شده (بدهی آینده)</small><b>{usd(String(sum(rows, 'profitLocked')))} USDT</b></div>
      <div className={Number(pool) < 0 ? 'negative' : ''}><small>موجودی صندوق اینوست</small><b>{usd(pool)} USDT</b></div>
    </div>
    {Number(pool) < 0 && <p role="alert">صندوق اینوست منفی است: سودها و بازپرداخت‌ها بیشتر از سهم واریزشده‌ی اینوست‌ها شده. این حساب داخلی است و پرداخت‌ها متوقف نمی‌شوند؛ موجودی واقعی ولت خزانه را بررسی کنید.</p>}
    <label>جستجوی کاربر<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="نام کاربری یا Telegram ID" /></label>
    <div className="admin-table">
      {visible.length === 0 ? <p>هنوز اینوستی ثبت نشده است.</p> : visible.map(row => <article key={row.id}>
        <div>
          <b>{row.user.firstName ?? 'کاربر'} {row.user.username ? `@${row.user.username}` : ''} · {usd(row.principal)} USDT</b>
          <small>سود: {usd(row.profitPaid)} USDT + {row.tokensPaid} GEN · پیشرفت: {usd(row.valueConsumed)} / {usd(row.maxProfit)} (Max Cap {usd(row.maxCap)}) · قفل: {usd(row.profitLocked)} USDT{row.profitReleasedAt ? ' · برداشت شد' : ''}</small>
          <small>شروع: {new Date(row.startedAt).toLocaleDateString('fa-IR')} · آخرین ماه تسویه: {row.settledThrough ?? '—'} · {row.fixedCycles} سایکل{row.status === 'CANCELLED' ? ` · بازپرداخت: ${usd(row.refundAmount ?? '0')} USDT` : row.cancellation.eligible ? ` · قابل لغو تا ${new Date(row.cancellation.deadline).toLocaleDateString('fa-IR')}` : ''}</small>
        </div>
        <span className={`status ${row.status.toLowerCase()}`}>{statusFa[row.status]}</span>
      </article>)}
    </div>
  </section>;
}
