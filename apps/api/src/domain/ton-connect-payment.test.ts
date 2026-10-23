import { Address } from '@ton/ton';
import { expect, it } from 'vitest';
import { buildInvoiceTransferPayload } from './ton-connect-payment.js';

const treasury = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
const payer = Address.parse('0:' + '1'.repeat(64));

it('fixes amount, recipient, refund address and invoice comment in the signed transfer', () => {
  const body = buildInvoiceTransferPayload({ amount: 12_500_000n, treasury, payer, comment: 'GENYX:abc123', queryId: 7n }).beginParse();
  expect(body.loadUint(32)).toBe(0x0f8a7ea5);
  expect(body.loadUintBig(64)).toBe(7n);
  expect(body.loadCoins()).toBe(12_500_000n);
  expect(body.loadAddress().equals(treasury)).toBe(true);
  expect(body.loadAddress().equals(payer)).toBe(true);
  expect(body.loadBit()).toBe(false);
  expect(body.loadCoins()).toBe(1n);
  const forward = body.loadBit() ? body.loadRef().beginParse() : body;
  expect(forward.loadUint(32)).toBe(0);
  expect(forward.loadStringTail()).toBe('GENYX:abc123');
});
