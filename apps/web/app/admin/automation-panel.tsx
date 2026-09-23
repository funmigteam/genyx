'use client';
import { useEffect, useState } from 'react';
type Claim = { id: string; userId: string; taskId: string; quotedGen: number; quotedXp: number; quotedUsdt: number };
type Room = { id: string; title: string; status: string; remainingSeconds: number; bidGen: number; prizeUsdt: string; prizeGen: number; prizeXp: number; entryUsdt?: string; series?: string | null; round?: number | null };
type LotteryRound = { id: string; title: string; status: string; entryGen: number; prizeGen: number; prizeUsdt?: string; startsAt: string; endsAt: string; _count?: { entries: number } };
export function AutomationPanel({ token }: { token: string }) {
  const [claims, setClaims] = useState<Claim[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [auctionPackagePrices, setAuctionPackagePrices] = useState<{ A: string; B: string; C: string }>({ A: '3', B: '2', C: '1' });
  const [lottery, setLottery] = useState<LotteryRound[]>([]);
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }; if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${data.error ?? 'Request failed'}${typeof data.requestId === 'string' ? ` (کد پیگیری: ${data.requestId})` : ''}`);
    return data;
  };
  const refresh = async () => {
    const results = await Promise.allSettled([
      request('/v1/admin/task-claims').then(setClaims),
      request('/v1/auctions').then(setRooms),
      request('/v1/admin/lottery').then(setLottery),
      request('/v1/admin/auction-package-prices').then(setAuctionPackagePrices)
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed && failed.status === 'rejected') throw failed.reason;
  };
  useEffect(() => { void refresh().catch(e => setMessage(e.message)); const timer = setInterval(() => { void request('/v1/auctions').then(setRooms).catch(e => setMessage(e.message)); }, 10000); return () => clearInterval(timer); }, [token]);
  const run = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setMessage(''); try { await action(); setMessage('با موفقیت ذخیره شد.'); try { await refresh(); } catch { setMessage('عملیات ذخیره شد، اما تازه‌سازی صف تسک‌ها ناموفق بود. عملیات را دوباره ثبت نکنید.'); } } catch (e) { setMessage(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); } };
  return <section className="admin-card" id="auction-rooms" aria-label="Financial automation controls"><h2>مدیریت اتاق‌ها و پاداش</h2><p role="status">{message}</p>
    <fieldset disabled={busy} style={{ border: 0, minWidth: 0 }}><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => request('/v1/admin/auctions', 'POST', { title: form.get('title'), bidGen: Number(form.get('bidGen')), entryUsdt: String(form.get('entryUsdt')), prizeUsdt: String(form.get('prizeUsdt')), prizeGen: Number(form.get('prizeGen')), prizeXp: Number(form.get('prizeXp')), durationSeconds: Number(form.get('durationSeconds')) })); }}>
      <h3>ساخت اتاق مزایده</h3><p>جایزه را آزادانه تعیین کنید؛ هنگام برنده‌شدن، USDT به اعتبار داخلی برنده اضافه می‌شود. فقط هر پیشنهاد ثبت‌شده یک ثانیه کم می‌کند.</p>
      <label>نام اتاق<input name="title" list="room-names" required minLength={2} maxLength={120} placeholder="C1" /><datalist id="room-names"><option value="C1"/><option value="B1"/><option value="A1"/></datalist><small>برای چرخهٔ خودکار، نام را مانند C1، B1 یا A1 وارد کنید.</small></label>
      <label>هزینه هر پیشنهاد (GEN)<input name="bidGen" type="number" min={1} max={1000000} defaultValue={1} required /></label>
      <label>هزینه ورود اتاق سفارشی (USDT)<input name="entryUsdt" inputMode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,6})?" defaultValue="0" required /><small>برای اتاق‌های A/B/C قیمت از پکیج ورود لاتاری گرفته می‌شود؛ این فیلد فقط برای اتاق بدون سری است.</small></label>
      <label>جایزه تتر (USDT)<input name="prizeUsdt" inputMode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,6})?" defaultValue="0" required /><small>مبلغ واقعی را وارد کنید: 5 یعنی 5 تتر، و 0.000005 یعنی پنج میلیونیم تتر. صفر اضافه نکنید.</small></label>
      <label>جایزه GEN<input name="prizeGen" type="number" min={0} max={1000000} defaultValue={0} required /></label>
      <label>جایزه XP<input name="prizeXp" type="number" min={0} max={1000000} defaultValue={0} required /></label>
      <label>مدت پیشنهادشمار (ثانیه)<input name="durationSeconds" type="number" min={10} max={2592000} defaultValue={86400} required /></label><button>ساخت و رزرو جایزه</button>
    </form><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => request('/v1/admin/auction-package-prices', 'PUT', { A: String(form.get('A')), B: String(form.get('B')), C: String(form.get('C')) })); }}><h3>قیمت پکیج ورود لاتاری</h3><p>هر خرید دقیقاً دو ورود به تالارهای همان سری می‌دهد و مبلغ از کیف پول داخلی USDT کاربر کم می‌شود.</p><div className="admin-three">{(['A', 'B', 'C'] as const).map(series=><label key={series}>پکیج {series} (USDT)<input name={series} inputMode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,6})?" defaultValue={auctionPackagePrices[series]} required /></label>)}</div><button className="admin-primary">ذخیره قیمت پکیج‌ها</button></form><h3>تالارهای ثبت‌شده</h3>
    {rooms.map(room => <article key={room.id}><h4>{room.title}</h4><p>{({ OPEN: 'باز', AWAITING: 'در انتظار پرداخت برنده', CLOSED: 'پایان‌یافته' } as Record<string, string>)[room.status] ?? room.status} · پیشنهادشمار: {room.remainingSeconds} ثانیه</p><p>هزینه ورود تالار: {Number(room.entryUsdt ?? 0) / 1000000} USDT · هر پیشنهاد: {room.bidGen} GEN · جایزه: {Number(room.prizeUsdt) / 1000000} USDT + {room.prizeGen} GEN + {room.prizeXp} XP</p><button type="button" className="admin-danger" onClick={() => { if (window.confirm(`حذف «${room.title}»؟ حتی با وجود پیشنهاد، اتاق لغو و از پنل کاربران مخفی می‌شود.`)) void run(() => request(`/v1/admin/auctions/${room.id}/cancel`, 'POST', {})); }}>حذف لابی</button></article>)}
    <h3>اتاق‌های لاتاری</h3><p>حذف تکی فقط برای اتاق بدون ورودی است؛ برای شروع دوباره همهٔ اتاق‌های باز/لغوشده، ریست لاتاری را بزنید. ورودی‌های پرداخت‌شده به کاربران برگردانده می‌شود و قرعه‌های انجام‌شده حفظ می‌شوند.</p><button type="button" className="admin-danger" onClick={() => { if (!window.confirm('همه لابی‌های لاتاری باز/لغوشده حذف و ورودی‌ها مسترد شوند؟')) return; if (window.prompt('برای تأیید بنویسید RESET LOTTERY') === 'RESET LOTTERY') void run(() => request('/v1/admin/lottery/reset', 'POST', { confirmation: 'RESET LOTTERY' })); }}>ریست همه لابی‌های لاتاری</button>
    {lottery.map(round => <article key={round.id}><h4>{round.title}</h4><p>{round.status} · {round._count?.entries ?? 0} ورودی · جایزه {round.prizeUsdt ? Number(round.prizeUsdt) / 1000000 : 0} USDT + {round.prizeGen} GEN · هزینه {round.entryGen} GEN</p><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => request(`/v1/admin/lottery/${round.id}`, 'PATCH', { title: form.get('title'), description: form.get('description') || undefined, entryGen: Number(form.get('entryGen')), prizeGen: Number(form.get('prizeGen')), prizeUsdt: String(form.get('prizeUsdt')), startsAt: new Date(String(form.get('startsAt'))).toISOString(), endsAt: new Date(String(form.get('endsAt'))).toISOString(), status: form.get('status') })); }}><label>عنوان<input name="title" defaultValue={round.title} required /></label><div className="admin-two"><label>هزینه ورود GEN<input name="entryGen" type="number" min={1} defaultValue={round.entryGen} required /></label><label>جایزه GEN<input name="prizeGen" type="number" min={1} defaultValue={round.prizeGen} required /></label></div><label>جایزه USDT<input name="prizeUsdt" inputMode="decimal" defaultValue={round.prizeUsdt ? Number(round.prizeUsdt) / 1000000 : 0} required /></label><label>وضعیت<select name="status" defaultValue={round.status}><option value="DRAFT">پیش‌نویس</option><option value="OPEN">باز</option></select></label><button className="admin-primary">ذخیره ویرایش</button></form><button type="button" className="admin-danger" onClick={() => { if (window.confirm(`حذف اتاق لاتاری «${round.title}»؟ فقط بدون ورودی قابل حذف است.`)) void run(() => request(`/v1/admin/lottery/${round.id}`, 'DELETE')); }}>حذف اتاق لاتاری</button></article>)}
    <button type="button" className="admin-danger" onClick={() => { if (!window.confirm('همه تالارهای لاتاری و مزایده از حالت فعال خارج شوند؟ سوابق مالی حفظ می‌شود.')) return; if (window.prompt('برای تأیید بنویسید RESET ALL ROOMS') !== 'RESET ALL ROOMS') return; void run(async () => { await request('/v1/admin/lottery/reset', 'POST', { confirmation: 'RESET LOTTERY' }); return request('/v1/admin/auctions/reset', 'POST', { confirmation: 'RESET AUCTION ROOMS' }); }); }}>ریست همه تالارها</button>
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => request('/v1/admin/settings/season-prices', 'PUT', { '2': form.get('2'), '3': form.get('3'), '4': form.get('4') })); }}>
      <h3>قیمت خرید فصل</h3><p>سفارش قبلی تغییر نمی‌کند. فصل یک رایگان است.</p>
      {[2, 3, 4].map(season => <label key={season}>Season {season} (USDT)<input name={String(season)} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required /></label>)}<button>ذخیره قیمت‌ها</button>
    </form><h3>صف بررسی تسک</h3><button type="button" onClick={() => void run(refresh)}>به‌روزرسانی صف</button>
    {claims.map(claim => <article key={claim.id} style={{ overflowWrap: 'anywhere' }}><p>User {claim.userId} · Task {claim.taskId}</p><p>{claim.quotedGen} GEN · {claim.quotedXp} XP · {claim.quotedUsdt / 1000000} USDT</p><button onClick={() => void run(() => request(`/v1/admin/task-claims/${claim.id}/approve`, 'POST', {}))}>تأیید انجام و ثبت پاداش</button></article>)}
    </fieldset>
  </section>;
}
