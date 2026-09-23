'use client';
import { useEffect, useRef } from 'react';

export function WinnerCelebration({ award, close }: { award: { cents: string; prizeUsdt: string; prizeGen: number; prizeXp: number; status: string }; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const usdt = (BigInt(award.prizeUsdt) / 1000000n).toString() + '.' + String(BigInt(award.prizeUsdt) % 1000000n).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  const credited = award.status === 'PAID';
  return <dialog ref={dialog} className="winner-celebration" onClose={close} aria-label={credited ? 'Lottery prize credited' : 'Lottery winner'}>
    <button className="reward-close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
    <div className="winner-confetti" aria-hidden="true">✦ ✧ ★ ✦ ✧</div>
    <small>{credited ? 'PRIZE CREDITED' : 'WINNING NUMBER'}</small>
    <h2>{credited ? 'Your prize is ready!' : 'You are the winner!'}</h2>
    <div className="winner-number"><span>WINNING BID</span><strong>{award.cents}</strong><small>US cents</small></div>
    <div className="winner-postcard">
      <span>LOTTERY REWARD</span>
      <strong>+ {usdt} USDT</strong>
      {(award.prizeGen > 0 || award.prizeXp > 0) && <div className="winner-bonus-rewards">{award.prizeGen > 0 && <span className="winner-gen-reward">✦ + {award.prizeGen} GEN</span>}{award.prizeXp > 0 && <span className="winner-xp-reward">⚡ + {award.prizeXp} XP</span>}</div>}
      <small>{credited ? 'USDT has been added to your in-app wallet. You can request a manual withdrawal from Wallet.' : 'Claim the prize and the winning bid will be deducted directly from your in-app wallet.'}</small>
    </div>
    <button className="winner-continue" onClick={() => dialog.current?.close()}>{credited ? 'Open wallet' : 'Continue'}</button>
  </dialog>;
}
