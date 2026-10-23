'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './celebration.css';

// Each action has its own motion so a prize never feels like a purchase:
// prize = coin rain + count-up, withdraw = launch trail, unlock = hall gate,
// purchase = activation rings, invest = growth bars, refund = coins return,
// gift = bursting box.
export type CelebrationKind = 'prize' | 'withdraw' | 'unlock' | 'purchase' | 'invest' | 'refund' | 'gift';
export type CelebrationInput = { kind: CelebrationKind; title: string; amount?: string; unit?: string; detail?: string; action?: string; onAction?: () => void };

const eyebrow: Record<CelebrationKind, string> = {
  prize: 'PRIZE UNLOCKED', withdraw: 'WITHDRAWAL ON ITS WAY', unlock: 'HALL ACCESS UNLOCKED', purchase: 'PACKAGE ACTIVATING',
  invest: 'INVESTMENT STARTED', refund: 'REFUND CREDITED', gift: 'DAILY GIFT CLAIMED',
};

function CountUp({ value }: { value: string }) {
  const target = Number(value);
  const [shown, setShown] = useState(Number.isFinite(target) ? 0 : value);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(target); return; }
    const decimals = value.includes('.') ? Math.min(value.split('.')[1].length, 2) : 0;
    const start = performance.now(), duration = 1100;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
      setShown(Number((target * eased).toFixed(decimals)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, value]);
  return <>{typeof shown === 'number' ? shown.toLocaleString('en-US', { maximumFractionDigits: 2 }) : shown}</>;
}

function Scene({ kind }: { kind: CelebrationKind }) {
  const particles = useMemo(() => Array.from({ length: 18 }, (_, index) => ({
    left: `${(index * 53) % 100}%`, delay: `${(index % 9) * 0.11}s`, duration: `${1.6 + (index % 5) * 0.25}s`, size: `${10 + (index % 4) * 5}px`,
  })), []);
  if (kind === 'prize' || kind === 'refund') return <div className={`celebration-scene scene-${kind}`} aria-hidden="true">
    {particles.map((p, i) => <i key={i} className="coin" style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration, width: p.size, height: p.size }} />)}
    {kind === 'refund' && <b className="wallet-glyph">◈</b>}
  </div>;
  if (kind === 'withdraw') return <div className="celebration-scene scene-withdraw" aria-hidden="true"><b className="rocket">➤</b><span className="trail" /><span className="trail delay" /></div>;
  if (kind === 'unlock') return <div className="celebration-scene scene-unlock" aria-hidden="true"><span className="gate left" /><span className="gate right" /><b className="key">✦</b></div>;
  if (kind === 'invest') return <div className="celebration-scene scene-invest" aria-hidden="true">{[38, 52, 64, 78, 96].map((h, i) => <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.12}s` }} />)}</div>;
  if (kind === 'gift') return <div className="celebration-scene scene-gift" aria-hidden="true"><b className="box">🎁</b>{particles.slice(0, 12).map((p, i) => <i key={i} className="spark" style={{ ['--angle' as string]: `${i * 30}deg`, animationDelay: '0.55s' }} />)}</div>;
  return <div className="celebration-scene scene-purchase" aria-hidden="true"><span className="ring" /><span className="ring delay" /><span className="ring delay2" /><b className="core">✓</b></div>;
}

export function Celebration({ input, close }: { input: CelebrationInput; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`celebration celebration-${input.kind}`} onClose={close} aria-label={input.title}>
    <button className="celebration-close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
    <Scene kind={input.kind} />
    <small className="celebration-eyebrow">{eyebrow[input.kind]}</small>
    <h2>{input.title}</h2>
    {input.amount && <p className="celebration-amount"><strong><CountUp value={input.amount} /></strong>{input.unit && <span> {input.unit}</span>}</p>}
    {input.detail && <p className="celebration-detail">{input.detail}</p>}
    <button className="celebration-action" onClick={() => { dialog.current?.close(); input.onAction?.(); }}>{input.action ?? 'Continue'}</button>
  </dialog>;
}

/** Returns the dialog node to render and a function that opens it. */
export function useCelebration(): [ReactNode, (input: CelebrationInput) => void] {
  const [input, setInput] = useState<CelebrationInput | null>(null);
  const celebrate = useCallback((next: CelebrationInput) => setInput(next), []);
  return [input ? <Celebration key={`${input.kind}-${input.title}-${input.amount}`} input={input} close={() => setInput(null)} /> : null, celebrate];
}
