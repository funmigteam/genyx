import { levelForXp } from '../domain/progression.js';

export function isChannelMember(member: { status?: string; is_member?: boolean } | undefined) {
  return !!member && (['creator', 'administrator', 'member'].includes(member.status ?? '') || (member.status === 'restricted' && member.is_member === true));
}

export async function checkChannelMembership(botToken: string, chatId: string, telegramId: bigint) {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: chatId, user_id: Number(telegramId) }),
    });
  } catch { throw new Error('Channel check unavailable. Try again later.'); }
  const payload = await response.json() as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
  if (!response.ok || !payload.ok) throw new Error('Cannot verify channel. The bot must be a channel administrator.');
  return isChannelMember(payload.result);
}

export function meetsTaskTarget(kind: string, target: number, xp: bigint, rounds = 0) {
  if (!Number.isSafeInteger(target) || target < 1) return false;
  if (kind === 'XP_REACHED') return xp >= BigInt(target);
  if (kind === 'LEVEL_REACHED') return levelForXp(xp).level >= target;
  if (kind === 'GAME_PLAYED') return rounds >= target;
  return false;
}
