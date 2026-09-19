import crypto from 'node:crypto';

export type TelegramIdentity = { id: bigint; username?: string; first_name?: string; last_name?: string; photo_url?: string };

export function verifyTelegramInitData(initData: string, botToken: string): TelegramIdentity {
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get('hash');
  if (!suppliedHash) throw new Error('Telegram initData has no hash');
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 300) throw new Error('Telegram initData expired');
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedHash))) throw new Error('Invalid Telegram initData');
  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Telegram initData has no user');
  const user = JSON.parse(rawUser) as { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string };
  return { id: BigInt(user.id), username: user.username, first_name: user.first_name, last_name: user.last_name, photo_url: typeof user.photo_url === 'string' && user.photo_url.startsWith('https://') ? user.photo_url : undefined };
}
