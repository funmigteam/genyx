import { Address } from '@ton/ton';
import type { Trace } from '@ton-api/client';

export function findDepositNotification(trace: Trace, expected: { recipient: Address; recipientJetton: Address; amount: bigint; comment: string }): string | null {
  if (trace.emulated) return null;
  const tx = trace.transaction, message = tx.inMsg;
  if (message?.msgType === 'int_msg' && !message.bounced && message.rawBody) {
    try {
      const body = message.rawBody.beginParse();
      const opcode = body.loadUint(32);
      // The treasury's own Jetton wallet sends transfer_notification only after
      // it has credited the tokens, and an internal message source cannot be
      // forged. The notification therefore proves the deposit even when the
      // treasury wallet aborts processing it: a W5 wallet cannot pay gas from
      // the customary 1-nanoTON forward amount.
      if (opcode === 0x7362d09c && tx.account.address.equals(expected.recipient) && message.source?.address.equals(expected.recipientJetton)) {
        body.loadUintBig(64);
        if (body.loadCoins() !== expected.amount) throw new Error('Incorrect amount');
        body.loadAddress();
        const payload = body.loadBit() ? body.loadRef().beginParse() : body;
        if (payload.loadUint(32) === 0 && payload.loadStringTail() === expected.comment) return tx.hash;
      }
      // A treasury owner wallet can be undeployed or temporarily unable to
      // process the 1-nanoTON notification.  The Jetton transfer itself has
      // nevertheless completed at its Jetton wallet.  Validate that completed
      // internal transfer as an equally strict fallback: recipient Jetton
      // wallet, exact amount and the invoice comment are all required.
      if (opcode === 0x178d4519 && tx.success && !tx.aborted && tx.account.address.equals(expected.recipientJetton)) {
        body.loadUintBig(64);
        if (body.loadCoins() !== expected.amount) throw new Error('Incorrect amount');
        body.loadAddress();
        body.loadAddress();
        body.loadCoins();
        const payload = body.loadBit() ? body.loadRef().beginParse() : body;
        if (payload.loadUint(32) === 0 && payload.loadStringTail() === expected.comment) return tx.hash;
      }
    } catch { /* Not this invoice. */ }
  }
  for (const child of trace.children ?? []) { const found = findDepositNotification(child, expected); if (found) return found; }
  return null;
}

export function findPayoutNotification(trace: Trace, expected: { recipient: Address; recipientJetton: Address; sender: Address; amount: bigint; queryId: bigint }): string | null {
  if (trace.emulated) return null;
  const tx = trace.transaction, message = tx.inMsg;
  if (message?.msgType === 'int_msg' && !message.bounced && message.rawBody) {
    try {
      const body = message.rawBody.beginParse();
      const opcode = body.loadUint(32);
      // As for deposits, the recipient Jetton wallet's notification proves the
      // tokens were credited even when the recipient's W5 wallet aborts it for
      // lack of gas. Treating that as "not paid" re-sent the same payout.
      if (opcode === 0x7362d09c && tx.account.address.equals(expected.recipient) && message.source?.address.equals(expected.recipientJetton)
        && body.loadUintBig(64) === expected.queryId && body.loadCoins() === expected.amount && body.loadAddress().equals(expected.sender)) return tx.hash;
      // The completed internal_transfer at the recipient Jetton wallet is the
      // credit itself; it also proves payment when no notification is sent.
      if (opcode === 0x178d4519 && tx.success && !tx.aborted && tx.account.address.equals(expected.recipientJetton)
        && body.loadUintBig(64) === expected.queryId && body.loadCoins() === expected.amount && body.loadAddress().equals(expected.sender)) return tx.hash;
    } catch { /* Malformed or unrelated message: never settle. */ }
  }
  for (const child of trace.children ?? []) { const found = findPayoutNotification(child, expected); if (found) return found; }
  return null;
}
