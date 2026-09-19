export function allocateReward(amount: bigint, cap: bigint, consumed: bigint, poolBalance: bigint) {
  if ([amount, cap, consumed, poolBalance].some(value => value < 0n)) throw new Error('Invalid reward balance');
  const capacity = cap > consumed ? cap - consumed : 0n;
  const credited = amount < capacity ? amount : capacity;
  if (credited > poolBalance) throw new Error('Reward pool has insufficient funds');
  return { credited, retained: amount - credited };
}
