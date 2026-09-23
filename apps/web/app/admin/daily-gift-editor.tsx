'use client';
import { useEffect, useMemo, useState } from 'react';
type Gift = { enabled: boolean; usdt: string; gen: number; xp: number };
type Policy = Gift & { days: Record<string, Gift> };
const emptyGift: Gift = { enabled: false, usdt: '0', gen: 0, xp: 0 };
const emptyPolicy: Policy = { ...emptyGift, days: {} };
export function DailyGiftEditor({ token }: { token: string }) {
  const [value, setValue] = useState<Policy>(emptyPolicy);
  const [dayNumber, setDayNumber] = useState(1);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const selected = useMemo(() => value.days[String(dayNumber)] ?? emptyGift, [value.days, dayNumber]);
  const request = async (save = false, payload = value) => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1/admin/daily-gift-policy`, { method: save ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(save ? { 'Content-Type': 'application/json' } : {}) }, ...(save ? { body: JSON.stringify(payload) } : {}) });
    const body = await response.json(); if (!response.ok) throw Error(body.error || 'خطا در ذخیره هدیه'); return body;
  };
  useEffect(() => { void request().then(data => { setValue({ ...emptyPolicy, ...data, days: data.days ?? {} }); setReady(true); }).catch(error => setMessage(error.message)); }, [token]);
  const updateSelected = (patch: Partial<Gift>) => setValue(current => ({ ...current, days: { ...current.days, [String(dayNumber)]: { ...emptyGift, ...current.days[String(dayNumber)], ...patch } } }));
  return <form className="admin-card" onSubmit={async event => { event.preventDefault(); setBusy(true); try { const scheduledPolicy = { ...value, enabled: false }; const result = await request(true, scheduledPolicy); setValue(scheduledPolicy); setMessage(result.updatedActiveDays ? `هدیه روز ${dayNumber} ذخیره شد و ${result.updatedActiveDays} روز فعال فوراً به‌روزرسانی شد.` : `هدیه روز ${dayNumber} ذخیره شد؛ برای روزهای جدید اعمال می‌شود.`); } catch(error) { setMessage(error instanceof Error ? error.message : 'خطا'); } finally { setBusy(false); } }}>
    <h3>تنظیم هدیه روزانه بر اساس روز فصل</h3><p>برای هر روز از فصل ۳۰ روزه، پاداش جداگانه تعیین کنید. روزهای غیرفعال از هدیه پیش‌فرض پکیج استفاده می‌کنند؛ ذخیره این بخش، روز فعالِ دریافت‌نشده را هم فوراً به‌روزرسانی می‌کند.</p>
    <fieldset className="season-day-picker"><legend>انتخاب روز هدیه</legend><div>{Array.from({ length: 30 }, (_, index) => { const day = index + 1; const configured = Boolean(value.days[String(day)]?.enabled); return <button key={day} type="button" className={`${dayNumber === day ? 'selected' : ''}${configured ? ' configured' : ''}`} aria-pressed={dayNumber === day} onClick={() => setDayNumber(day)}>روز {day}{configured ? ' ✓' : ''}</button>; })}</div></fieldset>
    <label><input type="checkbox" checked={selected.enabled} onChange={event => updateSelected({ enabled: event.target.checked })} />فعال‌سازی هدیه اختصاصی برای روز {dayNumber}</label>
    <label>USDT<input required inputMode="decimal" value={selected.usdt} onChange={event => updateSelected({ usdt: event.target.value })} /></label>
    <label>GEN<input required type="number" min="0" max="1000000" step="1" value={selected.gen} onChange={event => updateSelected({ gen: Number(event.target.value) })} /></label>
    <label>XP<input required type="number" min="0" max="1000000" step="1" value={selected.xp} onChange={event => updateSelected({ xp: Number(event.target.value) })} /></label>
    <button disabled={!ready || busy}>ذخیره هدیه روز {dayNumber}</button><p role="status">{message}</p>
  </form>;
}
