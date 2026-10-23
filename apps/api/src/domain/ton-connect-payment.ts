import { Address, beginCell, toNano } from '@ton/ton';

// TON attached to the payer's Jetton wallet; the unused part is refunded to
// the payer via response_destination.
export const tonConnectGasAmount = toNano('0.05');

/**
 * Builds the exact Jetton transfer the payer's wallet signs through TON
 * Connect. Recipient, amount and invoice comment are fixed by the server, so
 * the wallet can only approve or reject the payment, never edit it.
 */
export function buildInvoiceTransferPayload(input: { amount: bigint; treasury: Address; payer: Address; comment: string; queryId: bigint }) {
  const forwardPayload = beginCell().storeUint(0, 32).storeStringTail(input.comment).endCell();
  return beginCell()
    .storeUint(0x0f8a7ea5, 32).storeUint(input.queryId, 64).storeCoins(input.amount)
    .storeAddress(input.treasury).storeAddress(input.payer).storeBit(false)
    // One nanoTON makes the treasury receive the transfer_notification that
    // carries the invoice comment, which the deposit worker scans for.
    .storeCoins(1n).storeBit(true).storeRef(forwardPayload)
    .endCell();
}
