import { createWorker } from './worker-runner.js';
import { findPayoutNotification } from '../domain/jetton-confirmation.js';
import { broadcastSavedPayout } from '../domain/payout-outbox.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Address, JettonMaster, beginCell, external, internal, SendMode, storeMessage, toNano, WalletContractV5R1 } from '@ton/ton';
import { mnemonicValidate, mnemonicToPrivateKey } from '@ton/crypto';
import { TonApiClient } from '@ton-api/client';
import { ContractAdapter } from '@ton-api/ton-adapter';
import { PayoutJobStatus, WithdrawalStatus } from '@prisma/client';
import { env, payoutAutomationReady } from '../config.js';
import { prisma } from '../prisma.js';
import { reviewWithdrawal } from './withdrawals.js';

const queryIdFor = (id: string) => BigInt(`0x${createHash('sha256').update(id).digest('hex').slice(0, 16)}`);
const payoutGasBuffer = toNano('0.06');

class RetryablePayoutError extends Error {}
function isRetryableProviderError(error: unknown) {
  return /rate\s*limit|too many requests|\b429\b|temporarily unavailable|timeout/i.test(error instanceof Error ? error.message : String(error));
}
function safePayoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:api[_-]?key|token|secret|mnemonic)=?[^\s&]+/gi, '[redacted]').slice(0, 240);
}

// TonAPI's message lookup endpoint expects a hexadecimal hash, while the
// outbox stores the BOC hash in compact base64url form.
function messageHashHex(value: string) {
  return Buffer.from(value, 'base64url').toString('hex');
}

function tonApi() {
  return new TonApiClient({ baseUrl: env.TON_NETWORK === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io', apiKey: env.TONAPI_KEY });
}

/**
 * Sending an external message to more than one gateway is safe: TON de-dupes
 * identical BOCs by hash.  It protects payouts from a single provider accepting
 * a message but not relaying it to a validator quickly enough.
 */
async function broadcastPayout(client: TonApiClient, input: { signedBoc: string; externalMessageHash: string; validUntil: Date }) {
  await broadcastSavedPayout(input, async cell => {
    const tonCenterUrl = env.TON_NETWORK === 'mainnet'
      ? 'https://toncenter.com/api/v2/sendBoc'
      : 'https://testnet.toncenter.com/api/v2/sendBoc';
    const results = await Promise.allSettled([
      client.blockchain.sendBlockchainMessage({ boc: cell }),
      fetch(tonCenterUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boc: cell.toBoc().toString('base64') }),
      }).then(async response => {
        if (!response.ok) throw new Error(`TON Center broadcast rejected (${response.status})`);
        const body = await response.json().catch(() => null) as { ok?: boolean } | null;
        if (body?.ok === false) throw new Error('TON Center broadcast rejected');
      }),
    ]);
    if (results.every(result => result.status === 'rejected')) throw new Error('All payout broadcast providers rejected the message');
  });
}

async function payoutWallet() {
  if (!env.PAYOUT_SIGNING_KEY_FILE || !env.PAYOUT_WALLET_ADDRESS) throw new Error('Payout signer is not configured');
  const words = (await readFile(env.PAYOUT_SIGNING_KEY_FILE, 'utf8')).trim().split(/\s+/);
  if (words.length !== 24 || !await mnemonicValidate(words)) throw new Error('Payout signing secret is invalid');
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV5R1.create({ publicKey: keyPair.publicKey, walletId: { networkGlobalId: env.TON_NETWORK === 'mainnet' ? -239 : -3, context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 } } });
  const expected = Address.parse(env.PAYOUT_WALLET_ADDRESS).toRawString();
  if (wallet.address.toRawString() !== expected) throw new Error('Payout signing secret does not match PAYOUT_WALLET_ADDRESS');
  return { wallet, keyPair };
}

async function submitJob(jobId: string) {
  const job = await prisma.payoutJob.findUniqueOrThrow({ where: { id: jobId }, include: { withdrawal: true } });
  const client = tonApi();
  const { wallet, keyPair } = await payoutWallet();
  const usdt = Address.parse(env.TON_USDC_MASTER_ADDRESS!);
  const destination = Address.parse(job.withdrawal.destination);
  const adapter = new ContractAdapter(client);
  const openedWallet = adapter.open(wallet);
  const senderJettonAddress = await adapter.open(JettonMaster.create(usdt)).getWalletAddress(wallet.address);
  const account = await client.accounts.getAccount(wallet.address);
  if (account.balance < payoutGasBuffer) throw new RetryablePayoutError('Payout wallet needs TON for network fees');
  const queryId = queryIdFor(job.id);
  const payload = beginCell()
    .storeUint(0x0f8a7ea5, 32).storeUint(queryId, 64).storeCoins(job.withdrawal.netAmount)
    .storeAddress(destination).storeAddress(wallet.address).storeBit(false).storeCoins(1n).storeMaybeRef(null).endCell();
  const seqno = await openedWallet.getSeqno();
  const validUntil = new Date((Math.floor(Date.now() / 1000) + 300) * 1000);
  const transfer = wallet.createTransfer({ seqno, timeout: Math.floor(validUntil.getTime() / 1000), secretKey: keyPair.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS, messages: [internal({ to: senderJettonAddress, value: toNano('0.05'), body: payload })] });
  const message = external({ to: wallet.address, init: account.status === 'active' ? null : wallet.init, body: transfer });
  const boc = beginCell().store(storeMessage(message)).endCell();
  const externalMessageHash = boc.hash().toString('base64url');
  const signedBoc = boc.toBoc().toString('base64');
  const saved = await prisma.payoutJob.updateMany({ where: { id: job.id, status: 'SENDING', attempts: job.attempts, outboxVersion: 1 }, data: { status: PayoutJobStatus.SUBMITTED, externalMessageHash, signedBoc, validUntil, submittedAt: new Date(), lastError: null } });
  if (!saved.count) return;
  // Commit the exact signed bytes before any network submission.
  await broadcastPayout(client, { signedBoc, externalMessageHash, validUntil });
}

async function submitQueuedJobs() {
  const jobs = await prisma.payoutJob.findMany({ where: { status: PayoutJobStatus.QUEUED }, orderBy: { createdAt: 'asc' }, take: 1 });
  for (const job of jobs) {
    const locked = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(718291)`;
      // A signed external message cannot execute after validUntil.  It must
      // remain available for audit/reconciliation, but must never freeze every
      // later payout forever.  Legacy review records without a deadline stay
      // blocked for an operator because their chain state is unknowable.
      const now = new Date();
      const unresolved = await tx.payoutJob.count({ where: { OR: [
        { status: { in: ['SENDING', 'SUBMITTED'] } },
        { status: PayoutJobStatus.MANUAL_REVIEW, signedBoc: { not: null }, validUntil: { gt: now } },
      ] } });
      if (unresolved) return { count: 0 };
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: job.withdrawalId } });
      if (withdrawal.status !== 'APPROVED') return { count: 0 };
      return tx.payoutJob.updateMany({ where: { id: job.id, status: PayoutJobStatus.QUEUED }, data: { status: PayoutJobStatus.SENDING, outboxVersion: 1, attempts: { increment: 1 } } });
    });
    if (!locked.count) continue;
    try { await submitJob(job.id); }
    catch (error) {
      if (error instanceof RetryablePayoutError || isRetryableProviderError(error)) {
        await prisma.payoutJob.updateMany({ where: { id: job.id, status: PayoutJobStatus.SENDING }, data: { status: PayoutJobStatus.QUEUED, lastError: `Temporary payout provider issue; retrying automatically: ${safePayoutError(error)}` } });
        continue;
      }
      // A failed or interrupted broadcast is never retried automatically: it
      // might have reached the chain. An operator must reconcile it first.
      await prisma.payoutJob.updateMany({ where: { id: job.id, attempts: job.attempts + 1, status: { in: ['SENDING', 'SUBMITTED'] } }, data: { status: PayoutJobStatus.MANUAL_REVIEW, lastError: `Payout submission failed before broadcast: ${safePayoutError(error)}` } });
    }
  }
}

async function confirmSubmittedJobs() {
  const client = tonApi();
  // MANUAL_REVIEW jobs may come from the legacy sender and have no persisted
  // external hash. They are still safe to reconcile from the immutable
  // query-id/destination/amount tuple on the sender wallet.
  const jobs = await prisma.payoutJob.findMany({ where: { status: { in: [PayoutJobStatus.SUBMITTED, PayoutJobStatus.MANUAL_REVIEW] }, OR: [{ externalMessageHash: { not: null } }, { status: PayoutJobStatus.MANUAL_REVIEW }] }, take: 30 });
  for (const job of jobs) {
    try {
      const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: job.withdrawalId } });
      const recipient = Address.parse(withdrawal.destination);
      const recipientJetton = await new ContractAdapter(client).open(JettonMaster.create(Address.parse(env.TON_USDC_MASTER_ADDRESS!))).getWalletAddress(recipient);
      const expected = { recipient, recipientJetton, sender: Address.parse(env.PAYOUT_WALLET_ADDRESS!), amount: withdrawal.netAmount, queryId: queryIdFor(job.id) };
      let chainTxHash: string | null = null;

      // The indexed message-hash endpoint is the quickest confirmation path.
      // Some providers index an external-message hash later than the wallet
      // transaction itself, so fall back to recent sender-wallet traces. The
      // exact recipient, amount and query-id are still verified below.
      if (job.externalMessageHash) {
        try {
          const tx = await client.blockchain.getBlockchainTransactionByMessageHash(messageHashHex(job.externalMessageHash));
          if (tx.hash && tx.success && !tx.aborted) chainTxHash = findPayoutNotification(await client.traces.getTrace(tx.hash), expected);
        } catch { /* Fall back to sender-wallet transaction indexing. */ }
      }
      if (!chainTxHash) {
        const submittedAfter = Math.floor(((job.submittedAt ?? job.createdAt).getTime() - 60_000) / 1000);
        const recent = await client.blockchain.getBlockchainAccountTransactions(expected.sender, { limit: 20, sort_order: 'desc' });
        for (const tx of recent.transactions) {
          if (tx.utime < submittedAfter || !tx.success || tx.aborted) continue;
          const found = findPayoutNotification(await client.traces.getTrace(tx.hash), expected);
          if (found) { chainTxHash = found; break; }
        }
      }
      if (!chainTxHash) continue;
      if (withdrawal.status !== 'PAID') await reviewWithdrawal(job.withdrawalId, null, 'PAID', chainTxHash);
      else if (withdrawal.txHash !== chainTxHash) continue;
      await prisma.payoutJob.update({ where: { id: job.id }, data: { status: PayoutJobStatus.CONFIRMED, chainTxHash, confirmedAt: new Date() } });
    } catch {
      // Not found means the external message is still propagating; preserve it
      // for the next poll without creating another transfer.
    }
  }
}

async function createJobsForApprovedWithdrawals() {
  const withdrawals = await prisma.withdrawal.findMany({ where: { status: WithdrawalStatus.APPROVED, payoutJob: null }, select: { id: true }, take: 10 });
  for (const withdrawal of withdrawals) await prisma.payoutJob.upsert({ where: { withdrawalId: withdrawal.id }, create: { withdrawalId: withdrawal.id }, update: {} });
}

async function recoverOutbox() {
  // A legacy/manual failure with no signed BOC was never sent to the chain;
  // it is safe to return it to the queue instead of blocking all payouts.
  await prisma.payoutJob.updateMany({ where: { status: PayoutJobStatus.MANUAL_REVIEW, signedBoc: null, chainTxHash: null }, data: { status: PayoutJobStatus.QUEUED, lastError: 'Recovered unsent payout after worker restart' } });
  // Versioned jobs are known to persist bytes before sending. Legacy jobs are never reset.
  await prisma.payoutJob.updateMany({ where: { status: 'SENDING', outboxVersion: 1, signedBoc: null, updatedAt: { lt: new Date(Date.now() - 300000) } }, data: { status: 'QUEUED', lastError: 'Interrupted before message persistence' } });
  const jobs = await prisma.payoutJob.findMany({ where: { status: { in: ['SUBMITTED', 'MANUAL_REVIEW'] }, outboxVersion: 1, signedBoc: { not: null }, validUntil: { gt: new Date() } }, take: 10 });
  const client = tonApi();
  // Once validUntil has passed, an external message cannot be executed. Check
  // the chain first and only then allow a fresh signed message to be created.
  const expired = await prisma.payoutJob.findMany({ where: { status: PayoutJobStatus.SUBMITTED, outboxVersion: 1, signedBoc: { not: null }, validUntil: { lt: new Date() }, chainTxHash: null }, take: 10 });
  for (const job of expired) {
    let foundOnChain = false;
    try { foundOnChain = Boolean((await client.blockchain.getBlockchainTransactionByMessageHash(messageHashHex(job.externalMessageHash!))).hash); } catch { /* An expired message not found by the provider cannot execute. */ }
    if (!foundOnChain) await prisma.payoutJob.updateMany({ where: { id: job.id, status: PayoutJobStatus.SUBMITTED, chainTxHash: null, validUntil: { lt: new Date() } }, data: { status: PayoutJobStatus.QUEUED, externalMessageHash: null, signedBoc: null, validUntil: null, submittedAt: null, outboxVersion: null, lastError: 'Expired message was not found on chain; queued for a fresh payout' } });
  }
  for (const job of jobs) {
    if (!job.externalMessageHash || !job.validUntil) continue;
    try {
      await broadcastPayout(client, { signedBoc: job.signedBoc!, externalMessageHash: job.externalMessageHash, validUntil: job.validUntil });
    } catch { /* Preserve the signed message and reconcile; never re-sign. */ }
  }
}

export function startPayoutWorker(log: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void }) {
  if (!payoutAutomationReady) { log.info({ payoutAutomationReady: false }, 'Payout automation is disabled or incomplete'); return; }
  const worker = createWorker('payout', env.AUTOMATION_POLL_INTERVAL_MS, async () => {
    await createJobsForApprovedWithdrawals();
    await confirmSubmittedJobs();
    await recoverOutbox();
    await submitQueuedJobs();
  }, log);
  worker.start();
  return worker;
}
