import { describe, it, expect } from 'vitest';
import { Address, beginCell } from '@ton/ton';
import type { Trace } from '@ton-api/client';
import { findPayoutNotification, findDepositNotification } from './jetton-confirmation.js';
const recipient = new Address(0, Buffer.alloc(32, 1)), recipientJetton = new Address(0, Buffer.alloc(32, 2)), sender = new Address(0, Buffer.alloc(32, 3));
const expected = { recipient, recipientJetton, sender, amount: 100n, queryId: 42n };
function fixture(): Trace { return { transaction: { hash: 'confirmed', success: true, aborted: false, account: { address: recipient }, inMsg: { msgType: 'int_msg', bounced: false, source: { address: recipientJetton }, rawBody: beginCell().storeUint(0x7362d09c, 32).storeUint(42, 64).storeCoins(100n).storeAddress(sender).endCell() } }, interfaces: [] } as unknown as Trace; }
describe('payout notification verification', () => {
  it('accepts the exact notification', () => expect(findPayoutNotification(fixture(), expected)).toBe('confirmed'));
  it('rejects unrelated amounts and queries', () => { expect(findPayoutNotification(fixture(), { ...expected, amount: 99n })).toBeNull(); expect(findPayoutNotification(fixture(), { ...expected, queryId: 43n })).toBeNull(); });
  it('rejects a fake token wallet', () => expect(findPayoutNotification(fixture(), { ...expected, recipientJetton: sender })).toBeNull());
  it('rejects emulation and failed transactions', () => { const t = fixture(); t.emulated = true; expect(findPayoutNotification(t, expected)).toBeNull(); t.emulated = false; t.transaction.aborted = true; expect(findPayoutNotification(t, expected)).toBeNull(); });
  it('does not accept a wallet transaction alone', () => { const t = fixture(); t.transaction.inMsg = undefined; expect(findPayoutNotification(t, expected)).toBeNull(); });
});
describe('deposit notification verification', () => {
  function deposit(reference = true) {
    const trace = fixture();
    const payload = beginCell().storeUint(0, 32).storeStringTail('GENYX:invoice').endCell();
    const body = beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64).storeCoins(100n).storeAddress(sender).storeBit(reference);
    if (reference) body.storeRef(payload); else body.storeSlice(payload.beginParse());
    trace.transaction.inMsg!.rawBody = body.endCell();
    return trace;
  }
  const invoice = { recipient, recipientJetton, amount: 100n, comment: 'GENYX:invoice' };
  it('accepts referenced and inline invoice payloads', () => {
    expect(findDepositNotification(deposit(), invoice)).toBe('confirmed');
    expect(findDepositNotification(deposit(false), invoice)).toBe('confirmed');
  });
  it('rejects wrong invoice, amount or token wallet', () => {
    expect(findDepositNotification(deposit(), { ...invoice, comment: 'GENYX:other' })).toBeNull();
    expect(findDepositNotification(deposit(), { ...invoice, amount: 101n })).toBeNull();
    expect(findDepositNotification(deposit(), { ...invoice, recipientJetton: sender })).toBeNull();
  });
  it('rejects emulated or bounced deposits', () => {
    const trace = deposit(); trace.emulated = true;
    expect(findDepositNotification(trace, invoice)).toBeNull();
    trace.emulated = false; trace.transaction.inMsg!.bounced = true;
    expect(findDepositNotification(trace, invoice)).toBeNull();
  });
});
