'use client';
import { useRef, useState } from 'react';
type Intent = { id: string; amountUsdc: string; treasuryAddress: string; jettonMasterAddress: string; expiresAt: string };
const normalize = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.');
export function WalletTopup({ request, changed, balance }: { request: <T,>(path: string, init?: RequestInit) => Promise<T>; changed: () => Promise<void>; balance: string }) {
  const [amount, setAmount] = useState(''), [intent, setIntent] = useState<Intent | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const guard = useRef(false);
  const valid = /^\d{1,7}(\.\d{1,6})?$/.test(amount) && Number(amount) >= 1 && Number(amount) <= 1000000;
  const create = async () => {
    if (guard.current || !valid) return; guard.current = true; setBusy(true); setMessage('');
    try { setIntent(await request<Intent>('/v1/payments/wallet-topup-intents', { method: 'POST', body: JSON.stringify({ amountUsdc: amount }) })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Top-up unavailable'); }
    finally { guard.current = false; setBusy(false); }
  };
  return <section className="user-wallet-card"><header><small>USER WALLET · USDT ON TON</small><h2>Your in-app balance</h2><strong>{(Number(balance) / 1000000).toLocaleString('en-US', { maximumFractionDigits: 6 })} <small>USDT</small></strong></header>
    <p>Hall entry fees are deducted from this balance, not directly from your connected wallet.</p>
    {!intent ? <form onSubmit={e => { e.preventDefault(); void create(); }}>
      <label htmlFor="topup-amount">Top-up amount</label><div className="wallet-amount-field"><input id="topup-amount" inputMode="decimal" autoComplete="off" placeholder="Enter amount" value={amount} disabled={busy} onChange={e => setAmount(normalize(e.target.value))} /><span>USDT</span></div>
      <div className="wallet-presets">{[1,5,10,25].map(n => <button key={n} type="button" disabled={busy} aria-pressed={amount === String(n)} onClick={() => setAmount(String(n))}>{n} USDT</button>)}</div>
      <small>Minimum 1 USDT · Use the TON network only. Wallet network fees are separate.</small><button className="primary" disabled={busy || !valid}>{busy ? 'Creating payment…' : 'Continue to charge wallet'}</button>
    </form> : <div className="wallet-payment-details"><h3>Pay {Number(intent.amountUsdc)} USDT</h3><p>Recipient</p><code>{intent.treasuryAddress}</code><p>Expires {new Date(intent.expiresAt).toLocaleString()}</p>
      <a className="mission-link-button" target="_blank" rel="noopener noreferrer" href={`https://app.tonkeeper.com/transfer/${encodeURIComponent(intent.treasuryAddress)}?jetton=${encodeURIComponent(intent.jettonMasterAddress)}&amount=${BigInt(intent.amountUsdc.split('.')[0]) * 1000000n + BigInt((intent.amountUsdc.split('.')[1] ?? '').padEnd(6, '0'))}&text=${encodeURIComponent(`GENYX:${intent.id}`)}`}>Pay in Tonkeeper</a>
      <p role="status">After payment, your balance is increased automatically after on-chain confirmation. No transaction hash is needed.</p><button type="button" onClick={() => { setIntent(null); setAmount(''); void changed(); }}>I have paid — check my balance</button>
    </div>}<p role="status">{message}</p>
  </section>;
}
