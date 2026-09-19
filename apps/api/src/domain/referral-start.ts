/** Telegram deep-link payloads are limited to a compact, URL-safe referral code. */
export function referralCodeFromStartCommand(text?: string): string | undefined {
  const match = text?.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/i);
  const payload = match?.[1];
  if (!payload?.startsWith('ref_')) return undefined;
  const code = payload.slice(4);
  return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : undefined;
}
