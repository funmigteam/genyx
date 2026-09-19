'use client';
import { useEffect, useRef, useState } from 'react';

export function BidCelebration({ cents, reward, close }: { cents: string; reward: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="bid-celebration" onClose={close} aria-label="Bid registered">
    <button className="reward-close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
    <small>BID REGISTERED</small><h2>Your number is in.</h2><p>Number {cents} was accepted.</p>
    {!opened ? <button className="reward-box" onClick={() => setOpened(true)} aria-label="Open your reward card">
      <svg viewBox="0 0 120 120" aria-hidden="true"><path d="M20 50h80v55H20z" fill="#9a61e8"/><path d="M12 35h96v22H12z" fill="#c99aff"/><path d="M53 35h14v70H53z" fill="#ffe19a"/><path d="M60 35C8 35 35-8 60 35c25-43 52 0 0 0" fill="none" stroke="#ffe19a" strokeWidth="7"/></svg><span>Tap to open</span>
    </button> : <div className="reward-postcard" role="status"><small>A GIFT FOR YOUR ENTRY</small><strong>{BigInt(reward) > 0n ? `+${reward} GEN` : 'Good luck!'}</strong><p>{BigInt(reward) > 0n ? 'Added to your account for your paid hall entry — yours to keep, even if you do not win. Every 1 USDT of entry earns 10 GEN.' : 'Your bid is registered. Free entries do not create an extra entry reward.'}</p><button onClick={() => dialog.current?.close()}>Continue</button></div>}
  </dialog>;
}
