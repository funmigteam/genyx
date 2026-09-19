'use client';
import { useEffect, useState } from 'react';
export function Countdown({ end }: { end: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(end) - now) / 1000));
  return <time dateTime={end} dir="ltr" aria-label="Time remaining">{Math.floor(seconds / 3600).toString().padStart(2,'0')}:{Math.floor(seconds % 3600 / 60).toString().padStart(2,'0')}:{(seconds % 60).toString().padStart(2,'0')}</time>;
}
