import { levelForXp } from "../domain/progression.js";

export function isChannelMember(
  member: { status?: string; is_member?: boolean } | undefined,
) {
  return (
    !!member &&
    (["creator", "administrator", "member"].includes(member.status ?? "") ||
      (member.status === "restricted" && member.is_member === true))
  );
}

export async function checkChannelMembership(
  botToken: string,
  chatId: string,
  telegramId: bigint,
) {
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ chat_id: chatId, user_id: Number(telegramId) }),
      },
    );
  } catch {
    throw new Error("Channel check unavailable. Try again later.");
  }
  const payload = (await response.json()) as {
    ok?: boolean;
    result?: { status?: string; is_member?: boolean };
  };
  if (!response.ok || !payload.ok)
    throw new Error(
      "Cannot verify channel. The bot must be a channel administrator.",
    );
  return isChannelMember(payload.result);
}

/** The task is intentionally stricter than channel membership: the user must own
 * the group, the bot must be an administrator, and the member count must meet
 * the configured target. Telegram calls are made by the server only. */
export async function checkOwnedGroupWithMembers(
  botToken: string,
  chatId: string,
  telegramId: bigint,
  minimumMembers: number,
) {
  const call = async (
    method: string,
    body: Record<string, string | number>,
  ) => {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json()) as { ok?: boolean; result?: any };
    if (!response.ok || !payload.ok)
      throw new Error(
        "Cannot verify the group. Add the GENYX bot as a group administrator first.",
      );
    return payload.result;
  };
  const [member, me, count] = await Promise.all([
    call("getChatMember", { chat_id: chatId, user_id: Number(telegramId) }),
    call("getMe", {}),
    call("getChatMemberCount", { chat_id: chatId }),
  ]);
  const bot = await call("getChatMember", { chat_id: chatId, user_id: me.id });
  // Telegram does not expose a stable "owner" flag through every client; creator
  // is the authoritative Bot API status.
  if (member?.status !== "creator")
    throw new Error("You must be the group owner to claim this task.");
  if (!bot || !["administrator", "creator"].includes(bot.status ?? ""))
    throw new Error("Add GENYX bot as a group administrator, then try again.");
  if (!Number.isInteger(count) || count < minimumMembers)
    throw new Error(`This group needs at least ${minimumMembers} members.`);
  return true;
}

export function meetsTaskTarget(
  kind: string,
  target: number,
  xp: bigint,
  rounds = 0,
) {
  if (!Number.isSafeInteger(target) || target < 1) return false;
  if (kind === "XP_REACHED") return xp >= BigInt(target);
  if (kind === "LEVEL_REACHED") return levelForXp(xp).level >= target;
  if (kind === "GAME_PLAYED") return rounds >= target;
  return false;
}
