'use client';

import { TonConnectUIProvider } from '@tonconnect/ui-react';

export function Providers({ children }: { children: React.ReactNode }) {
  // Tonkeeper validates the manifest URL before opening a wallet. It must be
  // absolute HTTPS; a relative path is accepted by browsers but rejected by
  // several wallet clients as an invalid manifest.
  return <TonConnectUIProvider manifestUrl="https://smartgenyx.com/tonconnect-manifest.json">{children}</TonConnectUIProvider>;
}
