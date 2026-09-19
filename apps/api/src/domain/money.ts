export function parseUsdt(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) throw new Error('Invalid USDT amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
export function formatUsdt(value: bigint): string {
  if (value < 0n) throw new Error('Negative USDT amount');
  return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, '0')}`;
}
