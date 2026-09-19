export function levelForXp(xp: bigint) {
  let level = 1, required = 250n, remaining = xp;
  while (level < 30 && remaining >= required) { remaining -= required; level++; required = 250n + BigInt((level - 1) * 100); }
  return { level, current: remaining.toString(), required: required.toString() };
}

export function dailyCapForXp(xp: bigint) {
  const progress = levelForXp(xp);
  if (progress.level === 30 && BigInt(progress.current) >= BigInt(progress.required)) return 1_500_000_000n;
  if (progress.level >= 16) return 1_000_000_000n;
  if (progress.level >= 11) return 750_000_000n;
  return 500_000_000n;
}
