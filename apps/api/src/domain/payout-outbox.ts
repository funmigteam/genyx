import { Cell } from '@ton/ton';

export async function broadcastSavedPayout(input: { signedBoc: string; externalMessageHash: string; validUntil: Date }, send: (cell: Cell) => Promise<unknown>, now = new Date()) {
  if (input.validUntil <= now) throw new Error('Signed payout expired; reconciliation required');
  const cells = Cell.fromBoc(Buffer.from(input.signedBoc, 'base64'));
  if (cells.length !== 1 || cells[0].hash().toString('base64url') !== input.externalMessageHash) throw new Error('Payout outbox integrity mismatch');
  await send(cells[0]);
}
