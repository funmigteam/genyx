import { Address, JettonMaster } from '@ton/ton';
import { TonApiClient, type Trace } from '@ton-api/client';
import { ContractAdapter } from '@ton-api/ton-adapter';
import { prisma } from '../prisma.js';
import { findDepositNotification } from '../domain/jetton-confirmation.js';

export async function discoverDeposits(client: TonApiClient, treasury: string, master: string, network: string, confirm: (id: string) => Promise<unknown>) {
  // Catch up a bounded backlog in one worker iteration rather than waiting a
  // full polling interval after every page. Cursor commits remain per item.
  for (let page = 0; page < 10; page++) {
    if (!await discoverDepositPage(client, treasury, master, network, confirm)) break;
  }
}

async function discoverDepositPage(client: TonApiClient, treasury: string, master: string, network: string, confirm: (id: string) => Promise<unknown>) {
  const recipient = Address.parse(treasury);
  const jetton = await new ContractAdapter(client).open(JettonMaster.create(Address.parse(master))).getWalletAddress(recipient);
  const key = `deposit-cursor:${network}:${recipient.toRawString()}:${Address.parse(master).toRawString()}`;
  const stored = await prisma.systemSetting.findUnique({ where: { key } });
  const after = typeof stored?.value === 'string' ? BigInt(stored.value) : 0n;
  const batch = await client.blockchain.getBlockchainAccountTransactions(recipient, { after_lt: after, sort_order: 'asc', limit: 100 });
  const transactions = [...batch.transactions].sort((a, b) => a.lt < b.lt ? -1 : a.lt > b.lt ? 1 : 0);
  for (const transaction of transactions) {
    if (transaction.lt <= after) continue;
    let invoice: string | undefined;
    try {
      const body = transaction.inMsg?.rawBody?.beginParse();
      if (body && body.loadUint(32) === 0x7362d09c) {
        body.loadUintBig(64); body.loadCoins(); body.loadAddress();
        const payload = body.loadBit() ? body.loadRef().beginParse() : body;
        if (payload.loadUint(32) === 0) {
          const comment = payload.loadStringTail();
          if (/^GENYX:[a-zA-Z0-9_-]{1,100}$/.test(comment)) invoice = comment.slice(6);
        }
      }
    } catch { /* Unrelated or malformed message. */ }
    if (invoice) {
      const payment = await prisma.payment.findUnique({ where: { id: invoice } });
      if (payment?.status === 'PENDING') {
        const valid = findDepositNotification({ transaction, interfaces: [] } as Trace, { recipient, recipientJetton: jetton, amount: payment.expectedAmount, comment: `GENYX:${payment.id}` });
        if (valid) {
          const received = new Date(transaction.utime * 1000);
          if (transaction.utime < Math.floor(payment.createdAt.getTime() / 1000) || received > payment.expiresAt) {
            await prisma.auditEvent.create({ data: { action: 'DEPOSIT_OUTSIDE_INVOICE_WINDOW', entityType: 'Payment', entityId: payment.id, after: { txHash: transaction.hash } } });
          } else {
            await prisma.payment.update({ where: { id: payment.id }, data: { chainTxHash: transaction.hash } });
            // Do not advance past a failed settlement: retry from this transaction.
            await confirm(payment.id);
          }
        }
      }
    }
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: transaction.lt.toString() }, update: { value: transaction.lt.toString() } });
  }
  return transactions.length === 100 && transactions.some(transaction => transaction.lt > after);
}
