'use client';

import { useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';

export function WalletPanel({ detailed = false }: { detailed?: boolean }) {
  const [ui] = useTonConnectUI();
  const address = useTonAddress();
  const wallet = useTonWallet();
  const connected = Boolean(wallet && address);
  const label = connected ? `${address.slice(0, 5)}…${address.slice(detailed ? -8 : -4)}` : 'Wallet not connected';
  return <section className={`wallet-panel ${detailed ? '' : 'compact'}`}>
    <div className="wallet-copy"><span>{detailed ? 'CONNECTED WALLET · TON' : 'TON KEEPER · TON CONNECT'}</span><b dir="ltr" title={connected ? address : undefined}>{label}</b>{detailed && <p>{connected ? 'Connected via TON Connect. Ownership verification is separate.' : 'Connect your wallet to see its address here.'}</p>}</div>
    <button className="ton-button" onClick={() => connected ? ui.disconnect() : ui.openModal()}>{connected ? 'Disconnect' : 'Connect wallet'}</button>
  </section>;
}
