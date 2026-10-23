import { Address, beginCell } from '@ton/ton';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ settings: new Map<string, unknown>(), payment: null as any, updates: [] as any[], audits: [] as any[] }));
vi.mock('../prisma.js', () => ({ prisma: {
  systemSetting: {
    findUnique: async ({ where }: any) => state.settings.has(where.key) ? { value: state.settings.get(where.key) } : null,
    upsert: async ({ where, create }: any) => { state.settings.set(where.key, create.value); },
  },
  payment: {
    findUnique: async () => state.payment,
    update: (args: any) => { state.updates.push(args.data); return Promise.resolve(); },
  },
  auditEvent: { create: (args: any) => { state.audits.push(args.data.action); return Promise.resolve(); } },
  $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
} }));
vi.mock('@ton-api/ton-adapter', () => ({ ContractAdapter: class { open() { return { getWalletAddress: async () => 'unused' }; } } }));
vi.mock('../domain/jetton-confirmation.js', () => ({ findDepositNotification: () => 'hash' }));
import { discoverDeposits } from './deposit-discovery.js';

const address = '0:' + '0'.repeat(64);
const now = Math.floor(Date.now() / 1000);
function notification(comment: string, utime: number) {
  const rawBody = beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64).storeCoins(1n).storeAddress(Address.parse(address))
    .storeBit(true).storeRef(beginCell().storeUint(0, 32).storeStringTail(comment).endCell()).endCell();
  return { lt: 1n, utime, hash: 'tx-hash', inMsg: { rawBody } };
}
const client = (utime: number) => ({ blockchain: { getBlockchainAccountTransactions: async () => ({ transactions: [notification('GENYX:pay1', utime)] }) } }) as any;

beforeEach(() => {
  state.settings.clear(); state.updates = []; state.audits = [];
  state.payment = { id: 'pay1', status: 'PENDING', expectedAmount: 1n, createdAt: new Date((now - 3600) * 1000), expiresAt: new Date((now - 60) * 1000) };
});

it('credits a payment that arrives after its invoice expired to the in-app balance', async () => {
  const confirm = vi.fn();
  await discoverDeposits(client(now), address, address, 'mainnet', confirm);
  expect(state.updates).toContainEqual({ chainTxHash: 'tx-hash', purpose: 'WALLET_TOPUP' });
  expect(state.audits).toEqual(['DEPOSIT_LATE_CREDITED_TO_WALLET']);
  expect(confirm).toHaveBeenCalledWith('pay1');
});

it('retries a failing settlement, then credits the balance so later deposits are not blocked', async () => {
  state.payment.expiresAt = new Date((now + 600) * 1000);
  const confirm = vi.fn(async () => { if (state.updates.at(-1)?.purpose !== 'WALLET_TOPUP') throw new Error('Duplicate package payment requires reconciliation'); });
  for (let attempt = 1; attempt < 3; attempt++) {
    await expect(discoverDeposits(client(now), address, address, 'mainnet', confirm)).rejects.toThrow(/Duplicate/);
    expect(state.audits).toEqual([]);
  }
  await discoverDeposits(client(now), address, address, 'mainnet', confirm);
  expect(state.audits).toEqual(['DEPOSIT_UNSETTLEABLE_CREDITED_TO_WALLET']);
  expect(state.updates.at(-1)).toEqual({ chainTxHash: 'tx-hash', purpose: 'WALLET_TOPUP' });
});
