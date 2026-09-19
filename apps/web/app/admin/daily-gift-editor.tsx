'use client';
import { useEffect, useState } from 'react';
export function DailyGiftEditor({ token }: { token: string }) {
  const [value, setValue] = useState({ enabled: false, usdt: '0', gen: 0, xp: 0 });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const request = async (save = false) => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1/admin/daily-gift-policy`, { method: save ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(save ? { 'Content-Type': 'application/json' } : {}) }, ...(save ? { body: JSON.stringify(value) } : {}) });
    const body = await response.json(); if (!response.ok) throw Error(body.error || 'خطا در ذخیره هدیه'); return body;
  };
  useEffect(() => { void request().then(data => { setValue(data); setReady(true); }).catch(e => setMessage(e.message)); }, [token]);
  return <form className="admin-card" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await request(true); setMessage('ذخیره شد؛ برای روزهای جدید اعمال می‌شود.'); } catch(e) { setMessage(e instanceof Error ? e.message : 'خطا'); } finally { setBusy(false); } }}>
    <h3>تنظیم هدیه روزانه</h3><p>مبالغ هنگام ایجاد روز جدید ثبت می‌شوند؛ روزهای باز و جوایز قبلی تغییر نمی‌کنند. پاداش USDT همچنان تابع موجودی استخر و مکس‌کپ است.</p>
    <label><input type="checkbox" checked={value.enabled} onChange={e => setValue({ ...value, enabled: e.target.checked })} />جایگزینی هدیه پیش‌فرض با مقادیر زیر</label>
    <label>USDT<input required inputMode="decimal" value={value.usdt} onChange={e => setValue({ ...value, usdt: e.target.value })} /></label>
    <label>GEN<input required type="number" min="0" max="1000000" step="1" value={value.gen} onChange={e => setValue({ ...value, gen: Number(e.target.value) })} /></label>
    <label>XP<input required type="number" min="0" max="1000000" step="1" value={value.xp} onChange={e => setValue({ ...value, xp: Number(e.target.value) })} /></label>
    <button disabled={!ready || busy}>ذخیره هدیه روزانه</button><p role="status">{message}</p>
  </form>;
}
