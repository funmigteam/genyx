import { Cell, loadMessage } from '@ton/ton';

export async function broadcastSavedPayout(input: { signedBoc: string; externalMessageHash: string; validUntil: Date }, send: (cell: Cell) => Promise<unknown>, now = new Date()) {
  if (input.validUntil <= now) throw new Error('Signed payout expired; reconciliation required');
  const cells = Cell.fromBoc(Buffer.from(input.signedBoc, 'base64'));
  if (cells.length !== 1 || cells[0].hash().toString('base64url') !== input.externalMessageHash) throw new Error('Payout outbox integrity mismatch');
  await send(cells[0]);
}

/**
 * Seqno the saved W5 external message was signed for. Once its validUntil has
 * passed, the message can never execute; if the wallet seqno is still at or
 * below this value it never did, which is the only safe proof for re-signing.
 */
export function signedPayoutSeqno(signedBoc: string) {
  const message = loadMessage(Cell.fromBase64(signedBoc).beginParse());
  const body = message.body.beginParse();
  if (body.loadUint(32) !== 0x7369676e) throw new Error('Not a signed W5 transfer');
  body.loadUint(32); // wallet_id
  body.loadUint(32); // valid_until
  return body.loadUint(32);
}
