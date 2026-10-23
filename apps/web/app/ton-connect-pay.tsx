'use client';
import { useRef, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';

export type TonConnectTransfer = { validUntil: number; network: string; messages: { address: string; amount: string; payload: string }[] };

// The server fixes recipient, amount and invoice comment; the wallet can only
// approve or reject. Confirmation then happens automatically on-chain.
export function TonConnectPay({ loadTransfer, onSent, className = 'primary' }: { loadTransfer: (address: string) => Promise<TonConnectTransfer>; onSent?: () => void; className?: string }) {
  const [ui] = useTonConnectUI();
  const wallet = useTonWallet();
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [message, setMessage] = useState('');
  const guard = useRef(false);
  const pay = async () => {
    if (!wallet) return ui.openModal();
    if (guard.current) return;
    guard.current = true; setBusy(true); setMessage('');
    try {
      const transfer = await loadTransfer(wallet.account.address);
      if (wallet.account.chain !== transfer.network) throw new Error('Switch your wallet to TON mainnet and try again.');
      await ui.sendTransaction({ validUntil: transfer.validUntil, network: transfer.network, from: wallet.account.address, messages: transfer.messages });
      setSent(true);
      setMessage('Payment sent. It is confirmed automatically within about a minute — no transaction hash needed.');
      onSent?.();
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      setMessage(/reject|declin|cancel/i.test(text) ? 'Payment was cancelled in your wallet.' : text || 'Payment could not be sent. Try again.');
    } finally { guard.current = false; setBusy(false); }
  };
  return <>
    <button type="button" className={className} disabled={busy || sent} onClick={() => void pay()}>
      {busy ? 'Confirm in your wallet…' : sent ? 'Payment sent ✓' : wallet ? 'Pay with connected wallet' : 'Connect wallet to pay'}
    </button>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </>;
}
