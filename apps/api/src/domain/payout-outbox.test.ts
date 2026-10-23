import { expect, it, vi } from 'vitest';
import { beginCell, external, internal, SendMode, storeMessage, toNano, WalletContractV5R1 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';
import { broadcastSavedPayout, signedPayoutSeqno } from './payout-outbox.js';

const cell = beginCell().storeUint(123, 32).endCell();
const now = new Date('2026-09-07T12:00:00Z');
const input = { signedBoc: cell.toBoc().toString('base64'), externalMessageHash: cell.hash().toString('base64url'), validUntil: new Date(now.getTime() + 300000) };
it('retries exactly the saved message after an ambiguous network failure', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
  await expect(broadcastSavedPayout(input, send, now)).rejects.toThrow('network');
  await broadcastSavedPayout(input, send, now);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0].toBoc().equals(send.mock.calls[1][0].toBoc())).toBe(true);
});
it('never broadcasts an expired message', async () => {
  const send = vi.fn();
  await expect(broadcastSavedPayout(input, send, input.validUntil)).rejects.toThrow('expired');
  expect(send).not.toHaveBeenCalled();
});
it('never broadcasts bytes that do not match the stored identity', async () => {
  const send = vi.fn();
  await expect(broadcastSavedPayout({ ...input, externalMessageHash: 'wrong' }, send, now)).rejects.toThrow('integrity');
  expect(send).not.toHaveBeenCalled();
});
it('rejects a malformed saved message before contacting a provider', async () => {
  const send = vi.fn();
  await expect(broadcastSavedPayout({ ...input, signedBoc: 'invalid' }, send, now)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it('reads the seqno a saved W5 payout was signed for', () => {
  const keyPair = keyPairFromSeed(Buffer.alloc(32, 7));
  const wallet = WalletContractV5R1.create({ publicKey: keyPair.publicKey, walletId: { networkGlobalId: -239, context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 } } });
  const transfer = wallet.createTransfer({ seqno: 37, timeout: 2_000_000_000, secretKey: keyPair.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY, messages: [internal({ to: wallet.address, value: toNano('0.05') })] });
  const boc = beginCell().store(storeMessage(external({ to: wallet.address, body: transfer }))).endCell().toBoc().toString('base64');
  expect(signedPayoutSeqno(boc)).toBe(37);
});
