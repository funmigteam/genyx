'use client';
import { useRef, useState } from 'react';

export function DatabaseReset({ request }: { request: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const reset = async () => {
    if (confirmation !== 'RESET DATABASE') return;
    if (!window.confirm('همه کاربران، ولت‌ها، پرداخت‌ها، برداشت‌ها، رفرال‌ها، تسک‌ها، لاتاری و گزارش‌ها پاک می‌شوند. ادامه می‌دهید؟')) return;
    if (!window.confirm('این عملیات قابل بازگشت نیست؛ فقط فایل بکاپ سرور می‌تواند داده‌ها را برگرداند. تأیید نهایی؟')) return;
    setBusy(true); setMessage('در حال پاک‌سازی داده‌ها…');
    try {
      await request('/v1/admin/database/reset', { method: 'POST', body: JSON.stringify({ confirmation, requestKey: requestKey.current }) });
      setMessage('دیتابیس عملیاتی ریست شد. نشست شما منقضی می‌شود؛ در بات /start بزنید و دوباره وارد پنل شوید.');
      setConfirmation('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'ریست دیتابیس ناموفق بود.'); }
    finally { setBusy(false); }
  };
  return <section className="admin-card" dir="rtl" aria-busy={busy}>
    <span>ناحیه خطر</span><h2>ریست کامل دیتابیس عملیاتی</h2>
    <p>کاربران، رفرال‌ها، کیف‌ها، پرداخت‌ها، برداشت‌ها، تسک‌ها، شاپ، فصل‌ها، لاتاری، تیکت‌ها و گزارش‌ها پاک می‌شوند. قیمت، تخفیف و Max Cap پکیج‌ها حفظ می‌شوند.</p>
    <p>برای تأیید بنویسید: <bdi>RESET DATABASE</bdi></p>
    <input value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
    <button className="admin-danger" disabled={busy || confirmation !== 'RESET DATABASE'} onClick={() => void reset()}>{busy ? 'در حال ریست…' : 'ریست کامل دیتابیس'}</button>
    <p role="status">{message}</p>
  </section>;
}
