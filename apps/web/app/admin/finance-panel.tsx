'use client';
import { useEffect, useState, type FormEvent } from 'react';

type Payment = { id: string; packageCode: string; expectedAmount: string; status: string; chainTxHash?: string };
type Withdrawal = { id: string; amount: string; fee: string; netAmount: string; status: string; destination: string };
type Summary = { status: string; count: number; amount: string };
type CreditUser = { id: string; telegramId: string; username?: string | null; firstName?: string | null; referralCode?: string | null; maxCap: string; capConsumed: string };
const money = (value: string) => { const amount = BigInt(value); return `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, '0')} USDT`; };
const statusLabel = (status: string) => ({ PENDING: 'در انتظار', CONFIRMED: 'تأییدشده', FAILED: 'ناموفق', CANCELLED: 'لغوشده', EXPIRED: 'منقضی‌شده', APPROVED: 'تأیید مدیر', REJECTED: 'ردشده', PROCESSING: 'در حال پردازش', SENT: 'ارسال‌شده', COMPLETED: 'تکمیل‌شده', PAID: 'پرداخت‌شده', SUBMITTED: 'ارسال به شبکه' }[status] ?? status);
const normalizeUsdtInput = (value: string) => value
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[٫،]/g, '.').replace(/[^0-9.]/g, '');

export function FinancePanel({ token }: { token: string }) {
  const [payments, setPayments] = useState<Payment[]>([]), [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]), [summary, setSummary] = useState<Summary[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [filter, setFilter] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [creditUsers, setCreditUsers] = useState<CreditUser[]>([]), [creditUserId, setCreditUserId] = useState(''), [creditAmount, setCreditAmount] = useState(''), [creditNote, setCreditNote] = useState('');
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const request = async (path: string) => {
    const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 403 ? 'برای مشاهده گزارش‌ها، دسترسی مدیریت مالی لازم است.' : response.status === 401 ? 'نشست شما منقضی شده است؛ دوباره وارد شوید.' : 'دریافت اطلاعات مالی ناموفق بود؛ دوباره تلاش کنید.');
    return response;
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const [p, w, r, users] = await Promise.all(['/v1/admin/payments', '/v1/admin/withdrawals', '/v1/admin/reports/financial', '/v1/admin/withdrawable-users'].map(async path => (await request(path)).json()));
      setPayments(p); setWithdrawals(w); setSummary(r.payments); setCreditUsers(users); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'دریافت اطلاعات مالی ناموفق بود.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [token]);
  const download = async () => { try {
    const blob = await (await request('/v1/admin/reports/financial.csv')).blob();
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'genyx-payments.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { setError(e instanceof Error ? e.message : 'دریافت خروجی ناموفق بود.'); } };
  const reviewWithdrawal = async (row: Withdrawal, status: string) => {
    if (busy) return;
    const txHash = status === 'PAID' ? window.prompt('پس از ارسال دستی مبلغ خالص، هش واقعی تراکنش را وارد کنید. درخواست قدیمی را بدون تطبیق زنجیره دوباره پرداخت نکنید.')?.trim() : undefined;
    if (status === 'PAID' && !txHash) return;
    if (!window.confirm(`وضعیت برداشت ${row.id} به ${status} تغییر کند؟ این دکمه هیچ انتقالی از ولت انجام نمی‌دهد.`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${api}/v1/admin/withdrawals/${row.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, txHash }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ثبت وضعیت ناموفق بود');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'خطای ارتباط'); }
    finally { setBusy(false); }
  };
  const review = async (row: Payment, status: 'CONFIRMED' | 'REJECTED') => {
    if (busy) return;
    if (status === 'CONFIRMED' && !row.chainTxHash) { setError('هش تراکنش این سفارش ثبت نشده است؛ ابتدا تراکنش واقعی باید به سفارش متصل شود. صرف ساخت سفارش به معنی پرداخت نیست.'); return; }
    if (!window.confirm(status === 'CONFIRMED' ? 'واریز واقعی را بررسی کرده‌اید؟ تأیید موجب فعال‌سازی و ثبت پاداش می‌شود.' : 'پرداخت رد و از صف انتظار خارج شود؟ سابقه حفظ می‌شود.')) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${api}/v1/admin/payments/${row.id}`, {method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${result.error || `خطای سرور: ${response.status}`}${typeof result.requestId === 'string' ? ` (کد پیگیری: ${result.requestId})` : ''}`);
      setPayments(current=>current.map(item=>item.id===row.id?{...item,status:result.status}:item));
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'ارتباط با سرور ناموفق بود.'); }
    finally { setBusy(false); }
  };
  const creditWithdrawable = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !creditUserId || !/^\d+(\.\d{1,6})?$/.test(creditAmount) || creditNote.trim().length < 3) return;
    if (!window.confirm(`اعتبار قابل‌برداشت ${creditAmount} USDT به کاربر انتخاب‌شده افزوده شود؟ این عمل در حسابداری ثبت می‌شود و مکس‌کپ کاربر را مصرف می‌کند.`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${api}/v1/admin/users/${creditUserId}/withdrawable-credit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsdt: creditAmount, note: creditNote.trim(), requestKey: crypto.randomUUID() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'ثبت اعتبار قابل‌برداشت ناموفق بود.');
      setCreditAmount(''); setCreditNote('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'ثبت اعتبار قابل‌برداشت ناموفق بود.'); }
    finally { setBusy(false); }
  };
  const matches = (row: Payment | Withdrawal) => `${row.id} ${row.status} ${statusLabel(row.status)} ${'destination' in row ? row.destination : `${row.packageCode} ${row.chainTxHash ?? ''}`}`.toLowerCase().includes(filter.trim().toLowerCase());
  const visiblePayments = payments.filter(row => showHistory || row.status === 'PENDING').filter(matches), visibleWithdrawals = withdrawals.filter(matches);
  return <section className="admin-card" id="finance" dir="rtl" aria-busy={busy}><h2>عملیات مالی</h2><p>جمع پرداخت‌های ثبت‌شده و آخرین ۲۰۰ درخواست. ارسال تراکنش به شبکه به معنای تأیید پرداخت نیست.</p>
    <button className="admin-primary" disabled={busy} onClick={refresh}>{busy ? 'در حال دریافت…' : 'به‌روزرسانی گزارش مالی'}</button> <button className="admin-primary" onClick={download}>خروجی CSV پرداخت‌ها</button>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={creditWithdrawable} className="admin-credit-form">
      <h3>افزودن اعتبار قابل‌برداشت به کاربر</h3>
      <p>این مبلغ در موجودی قابل‌برداشت کاربر قرار می‌گیرد، در دفتر حسابداری ثبت می‌شود و از مکس‌کپ باقیماندهٔ او کم خواهد شد.</p>
      <label>کاربر<select required value={creditUserId} onChange={event => setCreditUserId(event.target.value)}><option value="">انتخاب کاربر</option>{creditUsers.map(user => <option key={user.id} value={user.id}>{user.firstName ?? 'Telegram user'}{user.username ? ` · @${user.username}` : ''} · {user.referralCode ?? user.telegramId}</option>)}</select></label>
      <div className="admin-two"><label>مبلغ USDT<input required inputMode="decimal" value={creditAmount} onChange={event => setCreditAmount(normalizeUsdtInput(event.target.value))} placeholder="1.00" aria-describedby="credit-amount-help" /><small id="credit-amount-help">مثال: 1.00 — رقم فارسی یا انگلیسی پذیرفته می‌شود.</small></label><label>دلیل ثبت<input required minLength={3} maxLength={240} value={creditNote} onChange={event => setCreditNote(event.target.value)} placeholder="Manual reward" /></label></div>
      <button className="admin-primary" disabled={busy || !creditUserId}>افزودن اعتبار قابل‌برداشت</button>
    </form>
    <div className="admin-two">{summary.map(row => <p key={row.status}>{statusLabel(row.status)}: {row.count.toLocaleString('fa-IR')} پرداخت · <bdi>{money(row.amount)}</bdi></p>)}</div>
    <label>جست‌وجو در اطلاعات دریافت‌شده: شناسه، وضعیت، پکیج، آدرس یا هش تراکنش<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
    <h3>پرداخت‌ها ({visiblePayments.length.toLocaleString('fa-IR')})</h3>
    {!busy && !error && !visiblePayments.length && <p role="status">پرداختی مطابق جست‌وجو یافت نشد.</p>}
    <label><input type="checkbox" checked={showHistory} onChange={e=>setShowHistory(e.target.checked)} />نمایش تاریخچه تأییدشده و ردشده</label>
    <div className="admin-table">{visiblePayments.map(row => <article key={row.id}><div><b>{row.packageCode} · {money(row.expectedAmount)}</b><small dir="ltr">{row.id}</small><small dir="ltr" style={{overflowWrap:'anywhere'}}>{row.chainTxHash || 'هش تراکنش هنوز ثبت نشده است'}</small></div><span>{statusLabel(row.status)}</span>{row.status === 'PENDING' && <><button disabled={busy} onClick={()=>review(row,'CONFIRMED')}>تأیید خرید</button><button disabled={busy} onClick={()=>review(row,'REJECTED')}>رد پرداخت</button></>}</article>)}</div>
    <h3>برداشت‌ها ({visibleWithdrawals.length.toLocaleString('fa-IR')})</h3>
    {!busy && !error && !visibleWithdrawals.length && <p role="status">برداشتی مطابق جست‌وجو یافت نشد.</p>}
    <p>پرداخت دستی است. مبلغ خالص را روی شبکه TON به آدرس زیر بفرستید، سپس هش تراکنش را ثبت کنید. برداشت‌های قدیمی دارای سابقه ارسال نیاز به تطبیق دارند؛ دوباره پرداخت نکنید.</p>
    <div className="admin-table">{visibleWithdrawals.map(row => <article key={row.id}><div><b>خالص: <bdi>{money(row.netAmount)}</bdi></b><small>مبلغ: <bdi>{money(row.amount)}</bdi> · کارمزد: <bdi>{money(row.fee)}</bdi></small><small dir="ltr" style={{ overflowWrap: 'anywhere' }}>{row.destination}</small><small dir="ltr" style={{ overflowWrap: 'anywhere' }}>{row.id}</small></div><span>{statusLabel(row.status)}</span>{['REQUESTED','REVIEWING'].includes(row.status) && <button disabled={busy} onClick={() => reviewWithdrawal(row, 'APPROVED')}>تأیید برای پرداخت دستی</button>}{row.status === 'APPROVED' && <button disabled={busy} onClick={() => reviewWithdrawal(row, 'PAID')}>ثبت هش پرداخت انجام‌شده</button>}{['REQUESTED','REVIEWING','APPROVED'].includes(row.status) && <button disabled={busy} onClick={() => reviewWithdrawal(row, 'REJECTED')}>رد و آزادسازی موجودی</button>}</article>)}</div>
  </section>;
}
