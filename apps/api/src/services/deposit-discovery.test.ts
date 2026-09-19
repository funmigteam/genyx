import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cursor: '0', writes: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { systemSetting: {
  findUnique: async () => ({ value: state.cursor }),
  upsert: async (args: any) => { state.cursor = args.update.value; state.writes(); }
} } }));
vi.mock('@ton-api/ton-adapter', () => ({ ContractAdapter: class { open() { return { getWalletAddress: async () => 'unused' }; } } }));
import { discoverDeposits } from './deposit-discovery.js';
it('catches up multiple pages without waiting for the next polling interval', async () => {
  state.cursor = '0'; state.writes.mockClear();
  const get = vi.fn().mockResolvedValueOnce({ transactions: Array.from({length:100}, (_,i) => ({ lt: BigInt(i+1) })) }).mockResolvedValueOnce({ transactions: [{ lt: 101n }] });
  const confirm = vi.fn();
  const address = '0:' + '0'.repeat(64);
  await discoverDeposits({ blockchain: { getBlockchainAccountTransactions: get } } as any, address, address, 'mainnet', confirm);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1][1].after_lt).toBe(100n);
  expect(state.cursor).toBe('101');
  expect(confirm).not.toHaveBeenCalled();
});
