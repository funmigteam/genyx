export function quotedTaskXp(base: number, packageMultiplier: number, boosted: boolean) {
  if (!Number.isSafeInteger(base) || base < 0 || ![1, 2].includes(packageMultiplier)) throw new Error('Invalid XP quote');
  return base * packageMultiplier * (boosted ? 2 : 1);
}
