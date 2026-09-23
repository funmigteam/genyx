// Project source: https://github.com/funmigteam
import { parseUsdt, formatUsdt } from './domain/money.js';
import { jsonResponse } from './domain/json-response.js';
import { claimTask, approveTaskClaim } from './services/task-rewards.js';
import { dailyGiftPolicyInput } from './domain/daily-gift-policy.js';
import { checkChannelMembership } from './services/task-verification.js';
import { assignSponsor, referralChildren, binaryLanes } from './services/referral-tree.js';
import { referralCodeFromStartCommand } from './domain/referral-start.js';
import { resetDatabasePreservingPackages } from './services/database-reset.js';
import { currentTerms, termsStatus } from './services/terms.js';
import { profileStats, checkRequiredChannels, leaderboard } from './services/community.js';
import { walletChallenge, walletProofInput, saveProvenWallet } from './services/wallet-proof.js';
import { requiresMembership } from './domain/membership-policy.js';
import { taskLocked } from './domain/task-visibility.js';
import { recordBinaryVolume, processBinaryQueue } from './services/binary.js';
import { readPackagePricing } from './services/package-pricing.js';
import { getOrCreatePackageIntent } from './services/package-intents.js';
import { discoverDeposits } from './services/deposit-discovery.js';
import { createAuction, deleteUnusedAuction, placeAuctionBid, purchaseAuctionPackage, auctionPaymentIntent, claimAuctionAward, revealAuctionAward, confirmAuctionPayment, processAuctions } from './services/auctions.js';
import { enrollFreeSeason, claimSeasonGift, useSeasonGrace, extendCurrentSeasonDay, processSeasonDays, confirmSeasonPayment, createSeasonIntent, resetSeasonProgress } from './services/seasons.js';
import { settlePackagePools } from './services/package-pools.js';
import { createWorker } from './services/worker-runner.js';
import { PACKAGE_RULES, packageQuote, binarySettlement, seasonDayKey, BINARY_POOL_PERCENT } from './domain/economics-v2.js';
import { levelForXp, dailyCapForXp } from './domain/progression.js';
import { packageCatalogInput } from './domain/package-catalog.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import crypto from 'node:crypto';
import { Address, JettonMaster } from '@ton/ton';
import { ContractAdapter } from '@ton-api/ton-adapter';
import { findDepositNotification } from './domain/jetton-confirmation.js';
import { supportRoutes } from './services/support-routes.js';
import { installApiErrors } from './domain/api-errors.js';
import { TonApiClient } from '@ton-api/client';
import { bootstrapAdminTelegramIds, economics, env, payoutAutomationReady } from './config.js';
import { prisma } from './prisma.js';
import { verifyTelegramInitData } from './services/telegram.js';
import { requestWithdrawal, reviewWithdrawal } from './services/withdrawals.js';
import { startPayoutWorker } from './services/payout-worker.js';
import { accountBalance, postLedger } from './services/ledger.js';
import { LedgerKind, LotteryStatus, Prisma, ShopPaymentMethod } from '@prisma/client';

const app = Fastify({ logger: true });
installApiErrors(app);
supportRoutes(app, requireUser, requireAdmin);
app.addHook('preSerialization', async (_request, _reply, payload) => jsonResponse(payload));
const financialJson = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
await app.register(cors, { origin: env.APP_ORIGIN, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
await app.register(jwt, { secret: env.JWT_SECRET });

async function requireUser(request: typeof app extends never ? never : any, reply: any) {
  try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
  const current = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { role: true } });
  if (!current) return reply.code(401).send({ error: 'Account no longer exists' });
  request.user.role = current.role;
  if (current.role === 'USER' && requiresMembership(request.method, request.url.split('?')[0])) {
    try {
      const result = await checkRequiredChannels(request.user.sub, env.TELEGRAM_BOT_TOKEN);
      if (!result.verified) return reply.code(403).send({ error: 'ابتدا عضو کانال‌های اجباری شوید.', code: 'MEMBERSHIP_REQUIRED', channels: result.channels });
    } catch { return reply.code(503).send({ error: 'بررسی عضویت فعلاً در دسترس نیست؛ دوباره تلاش کنید.', code: 'MEMBERSHIP_UNAVAILABLE' }); }
  }
}

async function requireAdmin(request: typeof app extends never ? never : any, reply: any) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!['SUPER_ADMIN', 'CONTENT_ADMIN'].includes(request.user.role)) return reply.code(403).send({ error: 'Admin access required' });
}
async function requireFinanceAdmin(request: any, reply: any) {
  await requireUser(request, reply); if (reply.sent) return;
  if (!['SUPER_ADMIN', 'FINANCE_ADMIN'].includes(request.user.role)) return reply.code(403).send({ error: 'Finance admin access required' });
}

function hasPackageAccess(user: { activePackageCode: string | null; role: string }) {
  // Operational accounts need access to validate live features without buying a package.
  return Boolean(user.activePackageCode) || user.role !== 'USER';
}

const taskInput = z.object({
  title: z.string().min(2).max(120), description: z.string().max(600).optional(),
  kind: z.enum(['CHANNEL_JOIN', 'EXTERNAL_LINK', 'DAILY_CHECKIN', 'MANUAL_REVIEW', 'XP_REACHED', 'LEVEL_REACHED', 'GAME_PLAYED','LOTTERY_BID_COUNT','BINARY_AMOUNT','SHOP_BOOST_COUNT','SHOP_PROFILE_COUNT','SHOP_TIME_COUNT','DIRECT_COUNT','MAX_CAP_REACHED','USED_CAP_REACHED','SEASON_REACHED','CYCLES_REACHED','VOUCHERS_REACHED','GEN_SPENT','DAY_REACHED']).default('EXTERNAL_LINK'),
  channelChatId: z.string().regex(/^(@[a-zA-Z0-9_]{5,32}|-100\d+)$/).nullable().optional(),
  targetValue: z.number().int().min(1).max(1_000_000_000).default(1),
  dayNumber: z.number().int().min(1).max(30).nullable().optional(),
  gameKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional(),
  actionUrl: z.string().url().refine(value => /^https:\/\//.test(value), 'HTTPS link required').nullable().optional(), rewardGen: z.number().int().min(0).max(1_000_000).default(0),
  rewardXp: z.number().int().min(0).max(1_000_000).default(0), isDaily: z.boolean().default(false), startsAt: z.coerce.date().default(() => new Date()),
  rewardUsdt: z.number().int().min(0).max(1_000_000_000).default(0),
  endsAt: z.coerce.date().optional(), status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT')
});

function validateTaskConditions(task: { kind: string; channelChatId?: string | null; actionUrl?: string | null; targetValue: number; gameKey?: string | null }) {
  if (task.kind === 'CHANNEL_JOIN' && (!task.channelChatId || !task.actionUrl)) throw new Error('Channel ID and join link are required');
  if (task.kind === 'EXTERNAL_LINK' && !task.actionUrl) throw new Error('An external link is required');
  if (task.kind === 'LEVEL_REACHED' && task.targetValue > 30) throw new Error('Maximum level is 30');
  if (task.kind === 'GAME_PLAYED' && !task.gameKey) throw new Error('Game key is required');
}

const shopItemInput = z.object({
  sku: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/), title: z.string().min(2).max(80),
  description: z.string().max(500).optional(), category: z.string().min(2).max(30).default('BOOST'),
  genPrice: z.number().int().min(0).max(10_000_000).default(0), voucherPrice: z.number().int().min(0).max(10_000).default(0),
  durationMinutes: z.number().int().min(0).max(525_600).default(0), imageKey: z.string().max(30).default('spark'), active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(10_000).default(0)
});
const channelInput = z.object({ chatId: z.string().min(2).max(128), title: z.string().min(2).max(80), inviteUrl: z.string().url(), active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(10_000).default(0) });
const lotteryInput = z.object({ title: z.string().min(2).max(120), description: z.string().max(600).optional(), entryGen: z.number().int().min(1).max(10_000_000), prizeGen: z.number().int().min(1).max(1_000_000_000), prizeUsdt: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).default('0'), startsAt: z.coerce.date(), endsAt: z.coerce.date(), status: z.enum(['DRAFT', 'OPEN']).default('DRAFT') });
const auctionPackagePricesInput = z.object({ A: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), B: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), C: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/) });
const defaultAuctionPackagePrices = { A: '3', B: '2', C: '1' };
async function readAuctionPackagePrices() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'auction_package_prices' } });
  return setting ? auctionPackagePricesInput.parse(setting.value) : defaultAuctionPackagePrices;
}

function todayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: economics.timezone }).format(new Date()); }
async function ensureUserAccounts(userId: string) {
  await prisma.ledgerAccount.createMany({ data: [
    { userId, code: `USER:${userId}:USDC:AVAILABLE`, currency: 'USDC', type: 'AVAILABLE' }, { userId, code: `USER:${userId}:USDC:HOLD`, currency: 'USDC', type: 'HOLD' },
    { userId, code: `USER:${userId}:GEN:AVAILABLE`, currency: 'GEN', type: 'AVAILABLE' }, { userId, code: `USER:${userId}:GEN:SPENT`, currency: 'GEN', type: 'EXPENSE' }
  ], skipDuplicates: true });
}
async function creditReferralCommissions(tx: Prisma.TransactionClient, payment: { id: string; userId: string; packageCode: string; quotedGen: bigint | null }) {
  const policySetting = await tx.systemSetting.findUnique({ where: { key: 'referral_policy' } });
  const policy = (policySetting?.value ?? [{ level: 1, basisPoints: 800 }, { level: 2, basisPoints: 400 }, { level: 3, basisPoints: 200 }]) as Array<{ level: number; basisPoints: number }>;
  const packageGen = Number(payment.quotedGen ?? 0n);
  if (!packageGen) return;
  let source = await tx.user.findUnique({ where: { id: payment.userId }, select: { referredById: true } });
  for (const rule of policy.sort((a, b) => a.level - b.level).slice(0, 10)) {
    if (!source?.referredById || rule.level < 1 || rule.basisPoints < 1) break;
    const recipientId = source.referredById;
    const amount = Math.floor(packageGen * rule.basisPoints / 10_000);
    if (amount > 0) {
      const alreadyPaid = await tx.referralCommission.findUnique({ where: { paymentId_recipientId: { paymentId: payment.id, recipientId } } });
      if (alreadyPaid) { source = await tx.user.findUnique({ where: { id: recipientId }, select: { referredById: true } }); continue; }
      await tx.ledgerAccount.createMany({ data: [{ userId: recipientId, code: `USER:${recipientId}:GEN:AVAILABLE`, currency: 'GEN', type: 'AVAILABLE' }, { userId: recipientId, code: `USER:${recipientId}:GEN:SPENT`, currency: 'GEN', type: 'EXPENSE' }], skipDuplicates: true });
      const recipient = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${recipientId}:GEN:AVAILABLE` } });
      const rewards = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:GEN:REWARDS' }, create: { code: 'SYSTEM:GEN:REWARDS', currency: 'GEN', type: 'EXPENSE' }, update: {} });
      const commission = await tx.referralCommission.create({ data: { paymentId: payment.id, recipientId, sourceUserId: payment.userId, level: rule.level, genAmount: amount } });
      await postLedger({ idempotencyKey: `referral:${commission.id}`, kind: LedgerKind.REFERRAL_COMMISSION, referenceType: 'ReferralCommission', referenceId: commission.id, postings: [{ accountId: rewards.id, debit: BigInt(amount) }, { accountId: recipient.id, credit: BigInt(amount) }] }, tx);
    }
    source = await tx.user.findUnique({ where: { id: recipientId }, select: { referredById: true } });
  }
}
async function confirmPayment(id: string, actorId: string | null) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
    const before = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (before.status === 'CONFIRMED') return { id: before.id, status: before.status, packageCode: before.packageCode };
    if (before.status !== 'PENDING' || !before.chainTxHash) throw new Error('Payment is not eligible for confirmation');
    if (before.purpose === 'AUCTION') {
      const payment = await confirmAuctionPayment(tx, id);
      await tx.auditEvent.create({ data: { actorId, action: 'AUCTION_PAYMENT_CONFIRMED', entityType: 'Payment', entityId: id } });
      return { id, status: payment.status, packageCode: payment.packageCode };
    }
    if (before.purpose === 'SEASON') {
      const payment = await confirmSeasonPayment(tx, id);
      await tx.auditEvent.create({ data: { actorId, action: 'SEASON_PAYMENT_CONFIRMED', entityType: 'Payment', entityId: id } });
      return { id, status: payment.status, packageCode: payment.packageCode };
    }
    if (before.purpose === 'WALLET_TOPUP') {
      const recipient = await tx.ledgerAccount.upsert({ where: { code: `USER:${before.userId}:USDC:AVAILABLE` }, create: { userId: before.userId, code: `USER:${before.userId}:USDC:AVAILABLE`, currency: 'USDC', type: 'AVAILABLE' }, update: {} });
      const deposits = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:DEPOSITS' }, create: { code: 'SYSTEM:USDC:DEPOSITS', currency: 'USDC', type: 'REVENUE' }, update: {} });
      await postLedger({ idempotencyKey: `wallet-topup:${before.id}`, kind: LedgerKind.DEPOSIT, referenceType: 'Payment', referenceId: before.id, postings: [{ accountId: deposits.id, debit: before.expectedAmount }, { accountId: recipient.id, credit: before.expectedAmount }] }, tx);
      const payment = await tx.payment.update({ where: { id: before.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      await tx.user.update({ where: { id: before.userId }, data: { totalDeposited: { increment: before.expectedAmount } } });
      return { id, status: payment.status, packageCode: payment.packageCode };
    }
    if (before.purpose !== 'PACKAGE') throw new Error('Unsupported payment purpose');
    if (before.packageCode !== 'DIAMOND') {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${before.userId} FOR UPDATE`;
      const duplicate = await tx.payment.findFirst({ where: { userId: before.userId, packageCode: before.packageCode, status: 'CONFIRMED', id: { not: before.id } } });
      if (duplicate) throw new Error('Duplicate package payment requires reconciliation');
    }
    if (before.quotedGen === null) throw new Error('Historical payment requires reconciliation: package GEN quote is missing');
    if (before.quotedGen > 0n) {
      const recipient = await tx.ledgerAccount.upsert({ where: { code: `USER:${before.userId}:GEN:AVAILABLE` }, create: { userId: before.userId, code: `USER:${before.userId}:GEN:AVAILABLE`, currency: 'GEN', type: 'AVAILABLE' }, update: {} });
      const issued = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:GEN:PACKAGES' }, create: { code: 'SYSTEM:GEN:PACKAGES', currency: 'GEN', type: 'EXPENSE' }, update: {} });
      await postLedger({ idempotencyKey: `package-credit:${before.id}`, kind: LedgerKind.ADJUSTMENT, referenceType: 'Payment', referenceId: before.id, postings: [{ accountId: issued.id, debit: before.quotedGen }, { accountId: recipient.id, credit: before.quotedGen }] }, tx);
    }
    const payment = await tx.payment.update({ where: { id: before.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await tx.user.update({ where: { id: before.userId }, data: { activePackageCode: before.packageCode, packageActivatedAt: new Date(), totalDeposited: { increment: before.expectedAmount } } });
    await settlePackagePools(tx, before);
    await recordBinaryVolume(tx, payment.id);
    await enrollFreeSeason(tx, payment.userId);
    await tx.systemSetting.upsert({ where: { key: 'opening_started_at' }, create: { key: 'opening_started_at', value: new Date().toISOString() }, update: {} });
    await tx.auditEvent.create({ data: { actorId, action: actorId ? 'PAYMENT_CONFIRMED' : 'PAYMENT_AUTO_CONFIRMED', entityType: 'Payment', entityId: before.id, before: { status: before.status, txHash: before.chainTxHash }, after: { status: 'CONFIRMED', packageCode: before.packageCode, amount: before.expectedAmount.toString() } } });
    return { id: payment.id, status: payment.status, packageCode: payment.packageCode };
  });
}
function sameTonAddress(left: unknown, right: string) {
  try { return Address.parse(String(left)).toRawString() === Address.parse(right).toRawString(); } catch { return false; }
}
async function autoConfirmSubmittedPayments() {
  if (!env.AUTOMATION_ENABLED || !env.TONAPI_KEY || !env.PLATFORM_TREASURY_ADDRESS || !env.TON_USDC_MASTER_ADDRESS) return;
  const client = new TonApiClient({ baseUrl: env.TON_NETWORK === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io', apiKey: env.TONAPI_KEY });
  await discoverDeposits(client, env.PLATFORM_TREASURY_ADDRESS, env.TON_USDC_MASTER_ADDRESS, env.TON_NETWORK, id => confirmPayment(id, null));
  const payments = await prisma.payment.findMany({ where: { status: 'PENDING', chainTxHash: { not: null }, expiresAt: { gt: new Date() } }, take: 30 });
  for (const payment of payments) {
    try {
      const recipient = Address.parse(env.PLATFORM_TREASURY_ADDRESS!);
      const recipientJetton = await new ContractAdapter(client).open(JettonMaster.create(Address.parse(env.TON_USDC_MASTER_ADDRESS!))).getWalletAddress(recipient);
      const trace = await client.traces.getTrace(payment.chainTxHash!);
      const valid = findDepositNotification(trace, { recipient, recipientJetton, amount: payment.expectedAmount, comment: `GENYX:${payment.id}` });
      if (valid) await confirmPayment(payment.id, null);
    } catch {
      // The transaction can take time to index. It is retried until the intent expires.
    }
  }
}
function startPaymentWorker() {
  if (!env.AUTOMATION_ENABLED) return;
  const worker = createWorker('submitted-payments', env.AUTOMATION_POLL_INTERVAL_MS, autoConfirmSubmittedPayments, app.log);
  worker.start();
  return worker;
}
async function seedCoreContent() {
  const dailyCount = await prisma.task.count({ where: { isDaily: true } });
  if (dailyCount === 0) await prisma.task.createMany({ data: [
    { title: 'Daily check-in', description: 'Open GENYX and confirm your daily presence.', kind: 'DAILY_CHECKIN', rewardGen: 8, rewardXp: 20, isDaily: true, startsAt: new Date(), status: 'PUBLISHED' },
    { title: 'Community pulse', description: 'Read the official community update.', kind: 'EXTERNAL_LINK', rewardGen: 10, rewardXp: 25, isDaily: true, startsAt: new Date(), status: 'PUBLISHED' },
    { title: 'Learn & rise', description: 'Complete today’s learning activity.', kind: 'MANUAL_REVIEW', rewardGen: 12, rewardXp: 30, isDaily: true, startsAt: new Date(), status: 'PUBLISHED' },
    { title: 'Network mission', description: 'Check your referral activity.', kind: 'MANUAL_REVIEW', rewardGen: 10, rewardXp: 25, isDaily: true, startsAt: new Date(), status: 'PUBLISHED' },
    { title: 'Season action', description: 'Finish the featured daily mission.', kind: 'MANUAL_REVIEW', rewardGen: 15, rewardXp: 35, isDaily: true, startsAt: new Date(), status: 'PUBLISHED' }
  ] });
  const shopCount = await prisma.shopItem.count();
  if (shopCount === 0) await prisma.shopItem.createMany({ data: [
    { sku: 'TASK_TIME_30', title: '24-hour daily gift extension', description: 'Add 24 hours to your current day. Complete its tasks and claim the daily gift before the extended deadline. Purchase before time runs out.', category: 'TIME', genPrice: 40, voucherPrice: 1, durationMinutes: 1440, imageKey: 'clock', sortOrder: 1 },
    { sku: 'PROFILE_GOLD', title: 'Gold profile frame', description: 'Personalize your profile with an earned gold frame.', category: 'PROFILE', genPrice: 120, voucherPrice: 2, imageKey: 'frame', sortOrder: 2 },
    { sku: 'SEASON_BOOST', title: '24-hour XP boost', description: 'Double task XP for 24 hours. Multiplies the package XP benefit. Only one XP boost can be active.', category: 'BOOST', genPrice: 250, voucherPrice: 3, durationMinutes: 1440, imageKey: 'spark', sortOrder: 3 }
  ] });
  await prisma.shopItem.updateMany({ where: { sku: 'SEASON_BOOST', category: 'BOOST', durationMinutes: 0 }, data: { title: '24-hour XP boost', description: 'Double task XP for 24 hours. Multiplies package XP; active boosts do not stack.', durationMinutes: 1440 } });
  await prisma.shopItem.updateMany({ where: { sku: 'TASK_TIME_30', category: 'TIME', durationMinutes: 30 }, data: { title: '24-hour daily gift extension', description: 'Add 24 hours to the current day to finish tasks and claim your gift. Buy before the deadline.', durationMinutes: 1440 } });
  if (!await prisma.shopItem.findFirst({ where: { category: 'TIME', durationMinutes: 1440 } })) {
    await prisma.shopItem.upsert({ where: { sku: 'DAILY_GIFT_24H' }, update: {}, create: { sku: 'DAILY_GIFT_24H', title: '24-hour daily gift extension', description: 'Extend your current day by 24 hours. Buy before its deadline.', category: 'TIME', durationMinutes: 1440, genPrice: 40, voucherPrice: 1, imageKey: 'clock', sortOrder: 1 } });
  }
}

app.get('/health', async () => ({ ok: true }));
app.post('/v1/telegram/webhook', async (request: any, reply) => {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers['x-telegram-bot-api-secret-token'] !== env.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ error: 'Invalid webhook secret' });
  const update = z.object({ message: z.object({ text: z.string().optional(), from: z.object({ id: z.number(), username: z.string().optional(), first_name: z.string().optional() }) }).optional() }).passthrough().parse(request.body);
  if (update.message?.text?.trim().startsWith('/start')) {
    const from = update.message.from;
    const role = bootstrapAdminTelegramIds.has(String(from.id)) ? 'SUPER_ADMIN' : undefined;
    let user = await prisma.user.upsert({ where: { telegramId: from.id }, create: { telegramId: from.id, username: from.username, firstName: from.first_name, botStarts: 1, lastStartedAt: new Date(), ...(role ? { role } : {}) }, update: { username: from.username, firstName: from.first_name, botStarts: { increment: 1 }, lastStartedAt: new Date(), ...(role ? { role } : {}) } });
    if (role && user.referredById) user = await prisma.user.update({ where: { id: user.id }, data: { referredById: null } });
    if (!user.referralCode) user = await prisma.user.update({ where: { id: user.id }, data: { referralCode: `GEN-${user.telegramId.toString()}` } });
    const referralCode = referralCodeFromStartCommand(update.message.text);
    user = await assignSponsor(user.id, referralCode);
    const channels = await prisma.requiredChannel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    const welcome = await prisma.systemSetting.findUnique({ where: { key: 'welcome_message' } });
    const miniAppUrl = new URL(env.APP_ORIGIN);
    // Telegram delivers the deep-link payload to the bot, not reliably to the
    // Web App. Preserve it in the Open button as a second, authenticated path.
    if (referralCode) miniAppUrl.searchParams.set('ref', referralCode);
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ chat_id: from.id, text: typeof welcome?.value === 'string' ? welcome.value : 'Welcome to GENYX! Join the channels below, then open the Mini App.', reply_markup: { inline_keyboard: [...channels.map(c => [{ text: `Join ${c.title}`, url: c.inviteUrl }]), [{ text: 'Open GENYX', web_app: { url: miniAppUrl.toString() } }]] } }) });
    if (!response.ok) return reply.code(502).send({ error: 'Welcome delivery failed' });
  }
  return { ok: true };
});
app.post('/v1/auth/telegram', async (request, reply) => {
  const body = z.object({ initData: z.string().min(1), referralCode: z.string().max(64).optional() }).parse(request.body);
  try {
    const identity = verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
    const role = bootstrapAdminTelegramIds.has(String(identity.id)) ? 'SUPER_ADMIN' : undefined;
    let user = await prisma.user.upsert({ where: { telegramId: identity.id }, create: { telegramId: identity.id, username: identity.username, firstName: identity.first_name, displayName: [identity.first_name, identity.last_name].filter(Boolean).join(' '), photoUrl: identity.photo_url ?? null, ...(role ? { role } : {}) }, update: { username: identity.username, firstName: identity.first_name, displayName: [identity.first_name, identity.last_name].filter(Boolean).join(' '), photoUrl: identity.photo_url ?? null, ...(role ? { role } : {}) } });
    if (role && user.referredById) user = await prisma.user.update({ where: { id: user.id }, data: { referredById: null } });
    if (!user.referralCode) user = await prisma.user.update({ where: { id: user.id }, data: { referralCode: `GEN-${user.telegramId.toString()}` } });
    user = await assignSponsor(user.id, body.referralCode);
    await ensureUserAccounts(user.id);
    const token = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '1h' });
    return { token, user: { id: user.id, telegramId: user.telegramId.toString(), username: user.username, role: user.role } };
  } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : 'Invalid Telegram identity' }); }
});

app.get('/v1/me', { preHandler: requireUser }, async (request: any) => prisma.user.findUnique({ where: { id: request.user.sub }, include: { wallet: true } }));
app.get('/v1/me/stats', { preHandler: requireUser }, async (request: any) => financialJson(await profileStats(request.user.sub)));
app.get('/v1/me/earning-totals', { preHandler: requireUser }, async (request: any) => {
  const account = { userId: request.user.sub, currency: 'USDC', code: `USER:${request.user.sub}:USDC:AVAILABLE` };
  const [reward, binary] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { account, transaction: { kind: { in: ['DAILY_GIFT', 'SEASON_REWARD', 'LOTTERY_PRIZE'] } } }, _sum: { credit: true } }),
    prisma.ledgerEntry.aggregate({ where: { account, transaction: { kind: 'BINARY_COMMISSION' } }, _sum: { credit: true } }),
  ]);
  return { reward: (reward._sum.credit ?? 0n).toString(), binary: (binary._sum.credit ?? 0n).toString() };
});
app.get('/v1/me/referral-tree', { preHandler: requireUser }, async (request: any, reply) => {
  const q = z.object({ parentId: z.string().max(64).optional(), cursor: z.string().max(64).optional() }).parse(request.query);
  try { return await referralChildren(request.user.sub, q.parentId, q.cursor); }
  catch { return reply.code(403).send({ error: 'Team branch unavailable' }); }
});
app.get('/v1/me/binary-tree', { preHandler: requireUser }, async (request: any) => binaryLanes(request.user.sub));
app.get('/v1/commission-leaderboard', { preHandler: requireUser }, async (request: any) => financialJson(await leaderboard(request.user.sub)));
app.get('/v1/public-profile/:code', { preHandler: requireUser }, async (request: any, reply) => {
  const user = await prisma.user.findFirst({ where: { referralCode: String(request.params.code), publicProfile: true } });
  if (!user) return reply.code(404).send({ error: 'پروفایل عمومی نیست' });
  const stats = await profileStats(user.id);
  return financialJson({ displayName: stats.displayName, level: stats.level, season: stats.season, commission: stats.commission });
});
app.post('/v1/me/share-profile', { preHandler: requireUser }, async (request: any) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
  return prisma.user.update({ where: { id: request.user.sub }, data: { publicProfile: enabled }, select: { publicProfile: true, referralCode: true } });
});
app.post('/v1/onboarding/verify', { preHandler: requireUser }, async (request: any, reply) => {
  if (!(await termsStatus(request.user.sub)).accepted) return reply.code(422).send({ error: 'Please accept the Terms of Service first.' });
  try { return await checkRequiredChannels(request.user.sub, env.TELEGRAM_BOT_TOKEN); }
  catch {
    request.log.warn({ userId: request.user.sub }, 'Required channel verification unavailable');
    return reply.code(503).send({ error: 'Membership verification is temporarily unavailable. Please retry or contact support.', code: 'MEMBERSHIP_CHECK_UNAVAILABLE' });
  }
});
app.get('/v1/terms', async () => ({ text: (await currentTerms()).text }));
app.put('/v1/admin/content/:key', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'فقط سوپرادمین' });
  const key = z.enum(['terms_text', 'welcome_message']).parse(request.params.key);
  const { text } = z.object({ text: z.string().min(10).max(key === 'welcome_message' ? 3000 : 30000) }).parse(request.body);
  return prisma.$transaction(async tx => { const result = await tx.systemSetting.upsert({ where: { key }, create: { key, value: text }, update: { value: text } }); await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'CONTENT_UPDATED', entityType: 'SystemSetting', entityId: key, after: { text } } }); return result; });
});
app.get('/v1/me/terms', { preHandler: requireUser }, async (request: any) => termsStatus(request.user.sub));
app.post('/v1/me/terms', { preHandler: requireUser }, async (request: any, reply) => {
  const input = z.object({ accepted: z.literal(true), version: z.string().length(64) }).parse(request.body);
  const terms = await currentTerms();
  if (input.version !== terms.version) return reply.code(409).send({ error: 'Terms changed. Reload and read the current version.' });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'TERMS_ACCEPTED', entityType: 'Terms', entityId: terms.version, after: { version: terms.version } } });
  return { accepted: true };
});
app.patch('/v1/me/profile', { preHandler: requireUser }, async (request: any) => {
  const body = z.object({ language: z.literal('en').default('en') }).strict().parse(request.body);
  return prisma.$transaction(async tx => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: request.user.sub }, select: { displayName: true, language: true } });
    const result = await tx.user.update({ where: { id: request.user.sub }, data: { ...body, languageChosen: true }, select: { displayName: true, language: true } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'PROFILE_UPDATED', entityType: 'User', entityId: request.user.sub, before, after: result } });
    return result;
  });
});
// No user-facing score submission: only a trusted, authenticated super admin may attest game results.
app.post('/v1/admin/game-activity', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin required' });
  const body = z.object({ userId: z.string().min(1), gameKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), rounds: z.number().int().min(1).max(10000), eventKey: z.string().min(8).max(128) }).strict().parse(request.body);
  return prisma.$transaction(async tx => {
    await tx.user.findUniqueOrThrow({ where: { id: body.userId } });
    const previous = await tx.gameActivity.findUnique({ where: { eventKey: body.eventKey } });
    if (previous) {
      if (previous.userId !== body.userId || previous.gameKey !== body.gameKey || previous.rounds !== body.rounds) throw new Error('Game event conflict');
      return previous;
    }
    const result = await tx.gameActivity.create({ data: body });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'GAME_ACTIVITY_VERIFIED', entityType: 'GameActivity', entityId: result.id, after: body } });
    return result;
  });
});
app.get('/v1/me/referrals', { preHandler: requireUser }, async (request: any) => {
  const [user, commissions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, select: { referralCode: true, referredBy: { select: { username: true, firstName: true } }, _count: { select: { referrals: { where: { activePackageCode: { not: null } } } } } } }),
    prisma.referralCommission.aggregate({ where: { recipientId: request.user.sub }, _sum: { genAmount: true }, _count: { _all: true } })
  ]);
  return { referralCode: user.referralCode, referredBy: user.referredBy, directReferrals: user._count.referrals, commissions: commissions._count._all, commissionGen: commissions._sum.genAmount ?? 0 };
});
app.get('/v1/leaderboard', { preHandler: requireUser }, async () => {
  const rows = await prisma.user.findMany({ take: 100, orderBy: { referralCommissions: { _count: 'desc' } }, select: { id: true, username: true, firstName: true, avatarStyle: true, _count: { select: { referrals: { where: { activePackageCode: { not: null } } }, referralCommissions: true } }, referralCommissions: { select: { genAmount: true } } } });
  return rows.map((user, index) => ({ rank: index + 1, id: user.id, username: user.username, firstName: user.firstName, avatarStyle: user.avatarStyle, referrals: user._count.referrals, commissionGen: user.referralCommissions.reduce((sum, item) => sum + item.genAmount, 0) }));
});
app.get('/v1/tasks', { preHandler: requireUser }, async (request: any) => {
  const now = new Date();
  const day = await prisma.seasonDay.findFirst({ where: { enrollment: { userId: request.user.sub, endedAt: null }, closedAt: null }, orderBy: { opensAt: 'desc' } });
  const key = day ? `season:${day.id}` : seasonDayKey(now);
  const tasks = await prisma.task.findMany({ where: { status: 'PUBLISHED' }, orderBy: { startsAt: 'asc' }, include: { claims: { where: { userId: request.user.sub }, select: { claimKey: true, verifiedAt: true, settledAt: true } } } });
  // Return every published task so admin-created missions are visible in the
  // user panel. Daily/season rules still control whether a task is locked.
  return tasks.map(task => {
    const claim = task.claims.find(item => item.claimKey === (task.isDaily ? key : 'once'));
    return { ...task, locked: taskLocked(task, day, now), claimed: Boolean(claim?.settledAt), pending: Boolean(claim && !claim.settledAt), verified: Boolean(claim?.verifiedAt), claims: undefined };
  });
});
app.get('/v1/packages', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return readPackagePricing();
});
app.get('/v1/admin/package-catalog', { preHandler: requireAdmin }, async () => readPackagePricing(false));
app.post('/v1/payments/package-intents', { preHandler: requireUser }, async (request: any, reply) => {
  if (!env.PLATFORM_TREASURY_ADDRESS || !env.TON_USDC_MASTER_ADDRESS) return reply.code(503).send({ error: 'Payment configuration is not ready' });
  const body = z.object({ packageCode: z.string().min(2).max(32) }).parse(request.body);
  const catalog = await readPackagePricing();
  const selected = catalog.find(item => item.code === body.packageCode);
  if (!selected) return reply.code(404).send({ error: 'Package not found' });
  const expectedAmount = parseUsdt(selected.economicUsdc);
  const rule = PACKAGE_RULES.find(item => item.code === selected.code);
  if (!rule) return reply.code(422).send({ error: 'Package has no approved financial rule' });
  const owner = rule.owner * 1_000_000n;
  if (expectedAmount <= owner) return reply.code(422).send({ error: 'Package price must exceed owner allocation' });
  const base = expectedAmount - owner, binary = base * BINARY_POOL_PERCENT / 100n;
  if (expectedAmount <= 0n) return reply.code(422).send({ error: 'Invalid package amount' });
  let payment;
  try {
    payment = await getOrCreatePackageIntent(request.user.sub, { packageCode: selected.code, expectedAmount, quotedGen: BigInt(selected.gen), quotedOwner: owner, quotedBinary: binary, quotedReward: base - binary, quotedMaxCap: parseUsdt(selected.maxCapUsdt) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Package already purchased')) return reply.code(409).send({ error: error.message });
    throw error;
  }
  return { id: payment.id, packageCode: payment.packageCode, amountUsdc: formatUsdt(payment.expectedAmount), treasuryAddress: env.PLATFORM_TREASURY_ADDRESS, jettonMasterAddress: env.TON_USDC_MASTER_ADDRESS, expiresAt: payment.expiresAt };
});
app.post('/v1/payments/wallet-topup-intents', { preHandler: requireUser }, async (request: any, reply) => {
  if (!env.PLATFORM_TREASURY_ADDRESS || !env.TON_USDC_MASTER_ADDRESS) return reply.code(503).send({ error: 'Payment configuration is not ready' });
  const body = z.object({ amountUsdc: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/) }).parse(request.body);
  const expectedAmount = parseUsdt(body.amountUsdc);
  if (expectedAmount < 1000000n || expectedAmount > 1000000000000n) return reply.code(422).send({ error: 'Top-up must be between 1 and 1,000,000 USDT' });
  const payment = await prisma.payment.create({ data: { userId: request.user.sub, packageCode: 'WALLET_TOPUP', purpose: 'WALLET_TOPUP', expectedAmount, quotedOwner: 0n, quotedReward: expectedAmount, quotedBinary: 0n, quotedGen: 0n, quotedMaxCap: 0n, expiresAt: new Date(Date.now() + 1800000) } });
  return { id: payment.id, packageCode: payment.packageCode, amountUsdc: formatUsdt(payment.expectedAmount), treasuryAddress: env.PLATFORM_TREASURY_ADDRESS, jettonMasterAddress: env.TON_USDC_MASTER_ADDRESS, expiresAt: payment.expiresAt };
});
const seasonPricesInput = z.object({ '2': z.string().regex(/^\d+(\.\d{1,6})?$/), '3': z.string().regex(/^\d+(\.\d{1,6})?$/), '4': z.string().regex(/^\d+(\.\d{1,6})?$/) });
async function readSeasonPrices() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'season_prices' } });
  return seasonPricesInput.parse(setting?.value ?? { '2': '9', '3': '27', '4': '81' });
}
app.get('/v1/seasons/catalog', async () => ({ firstSeasonFree: true, prices: await readSeasonPrices() }));
app.put('/v1/admin/settings/season-prices', { preHandler: requireUser }, async (request: any, reply) => {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
  if (actor.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin required' });
  const prices = seasonPricesInput.parse(request.body);
  for (const price of Object.values(prices)) if (parseUsdt(price) <= 0n || parseUsdt(price) > 1000000000000n) return reply.code(422).send({ error: 'Invalid price' });
  return prisma.$transaction(async tx => {
    const setting = await tx.systemSetting.upsert({ where: { key: 'season_prices' }, create: { key: 'season_prices', value: prices }, update: { value: prices } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: 'SEASON_PRICES_UPDATED', entityType: 'SystemSetting', entityId: 'season_prices', after: prices } });
    return setting;
  });
});
app.post('/v1/payments/season-intents', { preHandler: requireUser }, async (request: any, reply) => {
  if (!env.PLATFORM_TREASURY_ADDRESS || !env.TON_USDC_MASTER_ADDRESS) return reply.code(503).send({ error: 'Payment configuration is not ready' });
  const body = z.object({ season: z.number().int().min(2).max(4) }).parse(request.body);
  const prices = await readSeasonPrices();
  const payment = await createSeasonIntent(request.user.sub, body.season, parseUsdt(prices[String(body.season) as keyof typeof prices]));
  return { id: payment.id, season: body.season, amountUsdc: formatUsdt(payment.expectedAmount), treasuryAddress: env.PLATFORM_TREASURY_ADDRESS, jettonMasterAddress: env.TON_USDC_MASTER_ADDRESS, expiresAt: payment.expiresAt };
});
app.post('/v1/payments/:id/transaction', { preHandler: requireUser }, async (request: any, reply) => {
  const body = z.object({ txHash: z.string().min(16).max(256) }).parse(request.body);
  const payment = await prisma.payment.findFirst({ where: { id: request.params.id, userId: request.user.sub } });
  if (!payment) return reply.code(404).send({ error: 'Payment intent not found' });
  if (payment.status !== 'PENDING' || payment.expiresAt < new Date()) return reply.code(422).send({ error: 'Payment intent is no longer pending' });
  try { return financialJson(await prisma.payment.update({ where: { id: payment.id }, data: { chainTxHash: body.txHash } })); }
  catch { return reply.code(409).send({ error: 'This transaction hash is already registered' }); }
});

app.get('/v1/app/bootstrap', { preHandler: requireUser }, async (request: any) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, include: { wallet: true } });
  await ensureUserAccounts(user.id);
  const [genAccount, usdcAccount, tasks, shopItems, channels, purchases] = await Promise.all([
    prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:GEN:AVAILABLE` } }), prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:USDC:AVAILABLE` } }),
    prisma.task.findMany({ where: { status: 'PUBLISHED' }, orderBy: { startsAt: 'asc' }, include: { claims: { where: { userId: user.id }, select: { claimKey: true, verifiedAt: true, settledAt: true } } } }),
    prisma.shopItem.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }), prisma.requiredChannel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, include: { memberships: { where: { userId: user.id }, select: { verifiedAt: true } } } }),
    prisma.shopPurchase.findMany({ where: { userId: user.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 20, include: { item: true } })
  ]);
  const currentSeason = await prisma.seasonEnrollment.findFirst({ where: { userId: user.id, currentDay: { gt: 0 } }, orderBy: { season: 'desc' }, include: { days: { where: { closedAt: null }, take: 1 } } });
  const now = new Date(), currentSeasonDay = currentSeason?.days[0], dailyKey = currentSeasonDay ? `season:${currentSeasonDay.id}` : seasonDayKey(now);
  const progress = currentSeason ? Math.min(100, currentSeason.completedDays / 30 * 100) : 0;
  const packageAccess = hasPackageAccess(user);
  return { user: { id: user.id, telegramId: user.telegramId.toString(), username: user.username, firstName: user.firstName, displayName: user.displayName, photoUrl: user.photoUrl, language: 'en', languageChosen: user.languageChosen, avatarStyle: user.avatarStyle, role: user.role, referralCode: user.referralCode ?? `GEN-${user.telegramId.toString()}`, package: user.activePackageCode, vouchers: user.vouchers, genSpent: user.genSpent.toString(), totalDeposited: user.totalDeposited.toString(), totalWithdrawn: user.totalWithdrawn.toString(), level: levelForXp(user.xp) }, balances: { gen: (await accountBalance(genAccount.id)).toString(), usdc: (await accountBalance(usdcAccount.id)).toString() }, season: { progress, currentDay: currentSeasonDay?.number ?? 0, eligibleSeasonTwo: Boolean(currentSeason), rewardMilestones: [] }, tasks: tasks.map(task => ({ ...task, locked: !packageAccess || taskLocked(task, currentSeasonDay, now), claimed: task.claims.some(claim => claim.claimKey === (task.isDaily ? dailyKey : 'once') && claim.settledAt), pending: task.claims.some(claim => claim.claimKey === (task.isDaily ? dailyKey : 'once') && !claim.settledAt), claims: undefined })), shopItems, channels: channels.map(channel => ({ id: channel.id, title: channel.title, inviteUrl: channel.inviteUrl, verified: Boolean(channel.memberships[0]?.verifiedAt) })), purchases };
});

app.post('/v1/tasks/:id/open', { preHandler: requireUser }, async (request: any, reply) => {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: request.params.id } });
  if (task.status !== 'PUBLISHED' || !task.actionUrl?.startsWith('https://')) return reply.code(422).send({ error: 'Mission link unavailable' });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'TASK_LINK_OPENED', entityType: 'Task', entityId: task.id } });
  return { url: task.actionUrl };
});
app.post('/v1/tasks/:id/claim', { preHandler: requireUser }, async (request: any, reply) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
  if (!hasPackageAccess(user)) return reply.code(403).send({ error: 'An active package is required before task rewards unlock.' });
  const task = await prisma.task.findUniqueOrThrow({ where: { id: request.params.id } }); const now = new Date();
  if (task.status !== 'PUBLISHED' || (task.dayNumber === null && (task.startsAt > now || (task.endsAt && task.endsAt <= now)))) return reply.code(422).send({ error: 'This task is not currently available.' });
  try { return await claimTask(user.id, task.id, now, env.TELEGRAM_BOT_TOKEN); }
  catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Task verification failed' }); }
});

app.get('/v1/admin/task-claims', { preHandler: requireAdmin }, async () => prisma.taskClaim.findMany({ where: { settledAt: null, quotedGen: { not: null } }, take: 200, orderBy: { createdAt: 'asc' } }));
app.post('/v1/admin/task-claims/:id/approve', { preHandler: requireAdmin }, async (request: any) => approveTaskClaim(request.user.sub, request.params.id));

app.post('/v1/shop/:id/purchase', { preHandler: requireUser }, async (request: any, reply) => {
  const body = z.object({ method: z.enum(['GEN', 'VOUCHER']) }).parse(request.body); const item = await prisma.shopItem.findUniqueOrThrow({ where: { id: request.params.id } }); const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
  if (!item.active) return reply.code(422).send({ error: 'This shop item is unavailable.' });
  const price = body.method === 'GEN' ? item.genPrice : item.voucherPrice; if (price <= 0) return reply.code(422).send({ error: 'This item cannot be purchased with that method.' });
  try { const purchase = await prisma.$transaction(async tx => {
    if (item.category === 'BOOST') {
      if(item.durationMinutes <= 0)throw new Error('Set a positive XP boost duration in admin');
      if(await tx.shopPurchase.findFirst({where:{userId:user.id,item:{category:'BOOST'},activeUntil:{gt:new Date()}}}))throw new Error('An XP boost is already active');
    }
    if (item.category === 'TIME') {
      if (item.durationMinutes !== 1440) throw new Error('Configure a 24-hour season extension item');
      await extendCurrentSeasonDay(tx, user.id);
    }
    if (body.method === 'VOUCHER') { const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } }); if (current.vouchers < price) throw new Error('Not enough vouchers'); await tx.user.update({ where: { id: user.id }, data: { vouchers: { decrement: price } } }); }
    else { const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:GEN:AVAILABLE` } }); const spent = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:GEN:SPENT` } }); if (await accountBalance(available.id) < BigInt(price)) throw new Error('Not enough GEN'); await postLedger({ idempotencyKey: `shop:${user.id}:${item.id}:${Date.now()}`, kind: LedgerKind.ADJUSTMENT, referenceType: 'ShopItem', referenceId: item.id, postings: [{ accountId: available.id, debit: BigInt(price) }, { accountId: spent.id, credit: BigInt(price) }] }, tx); await tx.user.update({ where: { id: user.id }, data: { genSpent: { increment: price } } }); }
    return tx.shopPurchase.create({ data: { userId: user.id, itemId: item.id, method: body.method as ShopPaymentMethod, genSpent: body.method === 'GEN' ? price : 0, vouchersSpent: body.method === 'VOUCHER' ? price : 0, activeUntil: item.durationMinutes ? new Date(Date.now() + item.durationMinutes * 60_000) : null } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); return purchase; } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Purchase failed' }); }
});

app.get('/v1/lottery', { preHandler: requireUser }, async (request: any) => {
  const now = new Date();
  return prisma.lotteryRound.findMany({
    where: { status: { in: [LotteryStatus.OPEN, LotteryStatus.DRAWN] }, endsAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) } },
    orderBy: { endsAt: 'asc' }, take: 30,
    include: { _count: { select: { entries: true } }, entries: { where: { userId: request.user.sub }, select: { id: true } } }
  }).then(rounds => rounds.map(round => ({ ...round, entered: round.entries.length > 0, entries: undefined })));
});

app.post('/v1/lottery/:id/enter', { preHandler: requireUser }, async (request: any, reply) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
  if (!hasPackageAccess(user)) return reply.code(403).send({ error: 'An active package is required before lottery entry.' });
  try { return await prisma.$transaction(async tx => {
    const round = await tx.lotteryRound.findUniqueOrThrow({ where: { id: request.params.id } });
    const now = new Date();
    if (round.status !== LotteryStatus.OPEN || round.startsAt > now || round.endsAt <= now) throw new Error('This lottery round is not open');
    const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:GEN:AVAILABLE` } });
    const reserve = await tx.ledgerAccount.upsert({ where: { code: `SYSTEM:GEN:LOTTERY:${round.id}` }, create: { code: `SYSTEM:GEN:LOTTERY:${round.id}`, currency: 'GEN', type: 'RESERVE' }, update: {} });
    const balance = await tx.ledgerEntry.aggregate({ where: { accountId: available.id }, _sum: { debit: true, credit: true } });
    if ((balance._sum.credit ?? 0n) - (balance._sum.debit ?? 0n) < BigInt(round.entryGen)) throw new Error('Not enough GEN');
    const entry = await tx.lotteryEntry.create({ data: { roundId: round.id, userId: user.id } });
    await postLedger({ idempotencyKey: `lottery-entry:${entry.id}`, kind: LedgerKind.LOTTERY_ENTRY, referenceType: 'LotteryEntry', referenceId: entry.id, postings: [{ accountId: available.id, debit: BigInt(round.entryGen) }, { accountId: reserve.id, credit: BigInt(round.entryGen) }] }, tx);
    await tx.auditEvent.create({ data: { actorId: user.id, action: 'LOTTERY_ENTERED', entityType: 'LotteryRound', entityId: round.id, after: { entryId: entry.id, entryGen: round.entryGen } } });
    return { id: entry.id, roundId: round.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Lottery entry failed' }); }
});

app.post('/v1/channels/:id/verify', { preHandler: requireUser }, async (request: any, reply) => {
  const channel = await prisma.requiredChannel.findUniqueOrThrow({ where: { id: request.params.id } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, select: { telegramId: true } });
  try {
    const joined = await checkChannelMembership(env.TELEGRAM_BOT_TOKEN, channel.chatId, user.telegramId);
    const record = await prisma.channelMembership.upsert({ where: { userId_channelId: { userId: request.user.sub, channelId: channel.id } }, create: { userId: request.user.sub, channelId: channel.id, verifiedAt: joined ? new Date() : null }, update: { verifiedAt: joined ? new Date() : null } });
    return { verified: Boolean(record.verifiedAt) };
  } catch { return reply.code(502).send({ error: 'Telegram membership verification is unavailable. Ensure the bot is an administrator in this channel.' }); }
});

app.get('/v1/admin/economics/preview', { preHandler: requireUser }, async (request: any, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { role: true } });
  if (user?.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin access required' });
  return financialJson({ version: 2, live: false, packages: PACKAGE_RULES.map(rule => ({ ...rule, regular: packageQuote(rule.code, false), opening: packageQuote(rule.code, true) })), boostsEnabled: true, internalTransfersEnabled: false, gracePeriod: 'SEASON', seasonRepurchaseAllowed: false, extraTimeAllowed: true });
});
app.post('/v1/admin/economics/preview-binary', { preHandler: requireUser }, async (request: any, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { role: true } });
  if (user?.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin access required' });
  const atomic = z.string().regex(/^\d{1,24}$/);
  const body = z.object({ left: atomic, right: atomic, previousSlots: atomic, allowance: atomic }).parse(request.body);
  return financialJson({ previewOnly: true, ...binarySettlement(BigInt(body.left), BigInt(body.right), BigInt(body.previousSlots), BigInt(body.allowance)) });
});
app.get('/v1/admin/reward-receipts', { preHandler: requireFinanceAdmin }, async () => financialJson(await prisma.rewardReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })));
app.get('/v1/admin/activity-stats', { preHandler: requireAdmin }, async () => {
  const [incoming, pendingPayments, pendingWithdrawals] = await Promise.all([
    prisma.payment.aggregate({where:{status:'CONFIRMED'},_sum:{expectedAmount:true}}),
    prisma.payment.aggregate({where:{status:'PENDING'},_sum:{expectedAmount:true}}),
    prisma.withdrawal.aggregate({where:{status:{in:['REQUESTED','REVIEWING']}},_sum:{amount:true}}),
  ]);
  const [users, activeUsers, claims, pendingClaims, seasons, gifts, auctions, bids, vouchers, binary, gameRounds] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { activePackageCode: { not: null } } }), prisma.taskClaim.count({ where: { settledAt: { not: null } } }), prisma.taskClaim.count({ where: { settledAt: null } }), prisma.seasonEnrollment.count(), prisma.seasonDay.count({ where: { claimedAt: { not: null } } }), prisma.auction.count(), prisma.auctionBid.count(), prisma.user.aggregate({ _sum: { vouchers: true } }), prisma.binaryReceipt.aggregate({ _sum: { credited: true } }), prisma.gameActivity.aggregate({ _sum: { rounds: true } })
  ]);
  return financialJson({ incomingUsdt: incoming._sum.expectedAmount ?? 0n, pendingPaymentsUsdt: pendingPayments._sum.expectedAmount ?? 0n, pendingWithdrawalsUsdt: pendingWithdrawals._sum.amount ?? 0n, users, activeUsers, claims, pendingClaims, seasons, gifts, auctions, bids, vouchers: vouchers._sum.vouchers ?? 0, binaryUsdt: binary._sum.credited ?? 0n, gameRounds: gameRounds._sum.rounds ?? 0 });
});
app.get('/v1/admin/daily-gifts', { preHandler: requireAdmin }, async () => financialJson(await prisma.seasonDay.findMany({ take: 100, orderBy: { opensAt: 'desc' }, include: { enrollment: { select: { userId: true, season: true } } } })));
app.get('/v1/admin/daily-gift-policy', { preHandler: requireAdmin }, async () => (await prisma.systemSetting.findUnique({ where: { key: 'daily_gift_policy' } }))?.value ?? { enabled: false, usdt: '0', gen: 0, xp: 0 });
app.put('/v1/admin/daily-gift-policy', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin required' });
  const value = dailyGiftPolicyInput.parse(request.body);
  return prisma.$transaction(async tx => {
    await tx.systemSetting.upsert({ where: { key: 'daily_gift_policy' }, create: { key: 'daily_gift_policy', value }, update: { value } });
    let updatedActiveDays = 0;
    for (const [dayNumber, gift] of Object.entries(value.days)) {
      if (!gift.enabled) continue;
      const result = await tx.seasonDay.updateMany({ where: { number: Number(dayNumber), closedAt: null, claimedAt: null, graceAt: null, enrollment: { endedAt: null } }, data: { gift: parseUsdt(gift.usdt) > 3_000_000n ? 3_000_000n : parseUsdt(gift.usdt), giftGen: gift.gen, giftXp: gift.xp } });
      updatedActiveDays += result.count;
    }
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'DAILY_GIFT_POLICY_UPDATED', entityType: 'SystemSetting', entityId: 'daily_gift_policy', after: value } });
    return { ...value, updatedActiveDays };
  });
});
app.get('/v1/auctions/history', { preHandler: requireUser }, async (request: any) => {
  const page = z.coerce.number().int().min(0).max(100000).parse(request.query.page ?? 0);
  // Cancelled rooms are administration-only audit records, not completed
  // lottery results.  Users should see only genuinely closed halls here.
  const where = { status: 'CLOSED' };
  const [total, rows] = await Promise.all([prisma.auction.count({ where }), prisma.auction.findMany({ where, skip: page * 20, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, title: true, status: true, createdAt: true, remainingSeconds: true, endsAt: true, bidGen: true, prizeUsdt: true, prizeGen: true, prizeXp: true, awards: true, _count: { select: { bids: true } } } })]);
  return financialJson({ rows, total, page });
});
app.get('/v1/auctions/:id/bids', { preHandler: requireUser }, async (request: any, reply) => {
  const auction = await prisma.auction.findFirst({ where: { id: request.params.id, status: 'CLOSED' }, select: { id: true } });
  if (!auction) return reply.code(404).send({ error: 'Completed lottery room not found' });
  const [total, rows] = await Promise.all([
    prisma.auctionBid.count({ where: { auctionId: auction.id } }),
    prisma.auctionBid.groupBy({ by: ['cents'], where: { auctionId: auction.id }, _count: { _all: true }, orderBy: { cents: 'asc' }, take: 1000 }),
  ]);
  return financialJson({ total, rows: rows.map(row => ({ cents: row.cents, count: row._count._all })), truncated: rows.length === 1000 });
});
app.get('/v1/admin/overview', { preHandler: requireAdmin }, async () => {
  const [users, tasks, packages, pendingPayments, pendingWithdrawals, confirmed] = await Promise.all([prisma.user.count(), prisma.task.count(), prisma.systemSetting.findUnique({ where: { key: 'package_prices' } }), prisma.payment.count({ where: { status: 'PENDING' } }), prisma.withdrawal.count({ where: { status: { in: ['REQUESTED', 'REVIEWING', 'APPROVED'] } } }), prisma.payment.aggregate({ where: { status: 'CONFIRMED' }, _sum: { expectedAmount: true } })]);
  return { users, tasks, packages: packages?.value ?? [], pendingPayments, pendingWithdrawals, confirmedUsdc: (confirmed._sum.expectedAmount ?? 0n).toString() };
});
app.post('/v1/admin/database/reset', { preHandler: requireUser }, async (request: any, reply) => {
  const body = z.object({ confirmation: z.literal('RESET DATABASE'), requestKey: z.string().uuid() }).parse(request.body);
  const actor = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { role: true } });
  if (actor?.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'فقط سوپرادمین می‌تواند دیتابیس را ریست کند.' });
  await resetDatabasePreservingPackages();
  await seedCoreContent();
  return { reset: true, requestKey: body.requestKey, message: 'Operational data was reset. Sign in again through Telegram.' };
});
app.get('/v1/admin/reports/financial', { preHandler: requireFinanceAdmin }, async () => {
  const [payments, withdrawals, recentPayments, recentWithdrawals] = await Promise.all([
    prisma.payment.groupBy({ by: ['status'], _sum: { expectedAmount: true }, _count: { _all: true } }),
    prisma.withdrawal.groupBy({ by: ['status'], _sum: { amount: true, fee: true, netAmount: true }, _count: { _all: true } }),
    prisma.payment.findMany({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' }, take: 30, select: { id: true, packageCode: true, expectedAmount: true, confirmedAt: true } }),
    prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, status: true, amount: true, fee: true, netAmount: true, createdAt: true } })
  ]);
  return { payments: payments.map(row => ({ status: row.status, count: row._count._all, amount: (row._sum.expectedAmount ?? 0n).toString() })), withdrawals: withdrawals.map(row => ({ status: row.status, count: row._count._all, amount: (row._sum.amount ?? 0n).toString(), fee: (row._sum.fee ?? 0n).toString(), netAmount: (row._sum.netAmount ?? 0n).toString() })), recentPayments: recentPayments.map(row => ({ ...row, expectedAmount: row.expectedAmount.toString() })), recentWithdrawals: recentWithdrawals.map(row => ({ ...row, amount: row.amount.toString(), fee: row.fee.toString(), netAmount: row.netAmount.toString() })) };
});
app.get('/v1/admin/reports/financial.csv', { preHandler: requireFinanceAdmin }, async (_request: any, reply) => {
  const rows = await prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 10_000, select: { id: true, packageCode: true, expectedAmount: true, status: true, chainTxHash: true, createdAt: true, confirmedAt: true } });
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = ['id,package,status,amount_atomic,transaction_hash,created_at,confirmed_at', ...rows.map(row => [row.id, row.packageCode, row.status, row.expectedAmount.toString(), row.chainTxHash, row.createdAt.toISOString(), row.confirmedAt?.toISOString()].map(quote).join(','))].join('\n');
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="genyx-payments.csv"').send(csv);
});
app.get('/v1/admin/settings/referral-policy', { preHandler: requireAdmin }, async () => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'referral_policy' } });
  return setting?.value ?? [{ level: 1, basisPoints: 800 }, { level: 2, basisPoints: 400 }, { level: 3, basisPoints: 200 }];
});
app.put('/v1/admin/settings/referral-policy', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin access required' });
  const value = z.array(z.object({ level: z.number().int().min(1).max(10), basisPoints: z.number().int().min(0).max(10_000) })).min(1).max(10).refine(rows => new Set(rows.map(row => row.level)).size === rows.length, 'Levels must be unique').parse(request.body);
  const setting = await prisma.systemSetting.upsert({ where: { key: 'referral_policy' }, create: { key: 'referral_policy', value }, update: { value } });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'REFERRAL_POLICY_UPDATED', entityType: 'SystemSetting', entityId: setting.key, after: value } }); return setting.value;
});
app.get('/v1/admin/audit-events', { preHandler: requireAdmin }, async () => prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { actor: { select: { telegramId: true, username: true, firstName: true } } } }).then(rows => rows.map(row => ({ ...row, actor: row.actor ? { ...row.actor, telegramId: row.actor.telegramId.toString() } : null }))));
app.get('/v1/admin/lottery', { preHandler: requireAdmin }, async () => prisma.lotteryRound.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { entries: true } } } }));
app.post('/v1/admin/lottery', { preHandler: requireAdmin }, async (request: any, reply) => {
  const input = lotteryInput.parse(request.body);
  if (input.endsAt <= input.startsAt) return reply.code(422).send({ error: 'Lottery end must be after its start' });
  const { prizeUsdt, ...values } = input;
  const round = await prisma.$transaction(async tx => {
    const created = await tx.lotteryRound.create({ data: { ...values, prizeUsdt: parseUsdt(prizeUsdt), createdById: request.user.sub } });
    const amount = parseUsdt(prizeUsdt);
    if (amount > 0n) {
      const reward = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:REWARD' }, create: { code: 'SYSTEM:USDC:REWARD', currency: 'USDC', type: 'RESERVE' }, update: {} });
      const reserve = await tx.ledgerAccount.create({ data: { code: `SYSTEM:USDC:LOTTERY:${created.id}`, currency: 'USDC', type: 'RESERVE' } });
      await postLedger({ idempotencyKey: `lottery-fund:${created.id}`, kind: LedgerKind.LOTTERY_PRIZE, referenceType: 'LotteryRound', referenceId: created.id, postings: [{ accountId: reward.id, debit: amount }, { accountId: reserve.id, credit: amount }] }, tx);
    }
    return created;
  });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'LOTTERY_CREATED', entityType: 'LotteryRound', entityId: round.id, after: { title: round.title, entryGen: round.entryGen, prizeGen: round.prizeGen, status: round.status } } });
  return round;
});
app.patch('/v1/admin/lottery/:id', { preHandler: requireAdmin }, async (request: any, reply) => {
  const input = lotteryInput.partial().parse(request.body); const before = await prisma.lotteryRound.findUniqueOrThrow({ where: { id: request.params.id } });
  if (before.status === LotteryStatus.DRAWN) return reply.code(422).send({ error: 'A drawn lottery cannot be edited' });
  const { prizeUsdt, ...lotteryValues } = input;
  const updateData = { ...lotteryValues, ...(prizeUsdt !== undefined ? { prizeUsdt: parseUsdt(prizeUsdt) } : {}) };
  const round = await prisma.lotteryRound.update({ where: { id: before.id }, data: updateData });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'LOTTERY_UPDATED', entityType: 'LotteryRound', entityId: round.id, before: { status: before.status }, after: { title: round.title, entryGen: round.entryGen, prizeGen: round.prizeGen, prizeUsdt: String(round.prizeUsdt), status: round.status } } }); return round;
});
app.delete('/v1/admin/lottery/:id', { preHandler: requireAdmin }, async (request: any, reply) => {
  try {
    return await prisma.$transaction(async tx => {
      const round = await tx.lotteryRound.findUniqueOrThrow({ where: { id: request.params.id }, include: { _count: { select: { entries: true } } } });
      if (round.status === LotteryStatus.DRAWN) throw new Error('A drawn lottery cannot be deleted; keep it as history');
      if (round._count.entries > 0) throw new Error('A lottery with entries cannot be deleted; cancel it to preserve the ledger history');
      const reserve = await tx.ledgerAccount.findUnique({ where: { code: `SYSTEM:GEN:LOTTERY:${round.id}` } });
      if (reserve) {
        const ledgerEntries = await tx.ledgerEntry.count({ where: { accountId: reserve.id } });
        if (ledgerEntries > 0) throw new Error('Lottery reserve has ledger history; deletion is blocked for accounting safety');
        await tx.ledgerAccount.delete({ where: { id: reserve.id } });
      }
      await tx.lotteryRound.delete({ where: { id: round.id } });
      await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'LOTTERY_DELETED', entityType: 'LotteryRound', entityId: round.id, before: { title: round.title, status: round.status } } });
      return { ok: true, deleted: true };
    });
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Lottery deletion failed' }); }
});
app.post('/v1/admin/lottery/reset', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'فقط سوپرادمین می‌تواند لاتاری را ریست کند.' });
  const body = z.object({ confirmation: z.literal('RESET LOTTERY') }).parse(request.body);
  try {
    return await prisma.$transaction(async tx => {
      const rounds = await tx.lotteryRound.findMany({ where: { status: { not: LotteryStatus.DRAWN } }, include: { entries: true } });
      let refundedEntries = 0;
      for (const round of rounds) {
        if (round.entries.length) {
          const reserve = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `SYSTEM:GEN:LOTTERY:${round.id}` } });
          for (const entry of round.entries) {
            const target = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${entry.userId}:GEN:AVAILABLE` } });
            await postLedger({ idempotencyKey: `lottery-reset-refund:${entry.id}`, kind: LedgerKind.ADJUSTMENT, referenceType: 'LotteryReset', referenceId: entry.id, metadata: { roundId: round.id }, postings: [{ accountId: reserve.id, debit: BigInt(round.entryGen) }, { accountId: target.id, credit: BigInt(round.entryGen) }] }, tx);
            refundedEntries++;
          }
        }
        await tx.lotteryRound.delete({ where: { id: round.id } });
      }
      await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'LOTTERY_RESET', entityType: 'LotteryRound', entityId: 'ALL', after: { deletedRounds: rounds.length, refundedEntries, confirmation: body.confirmation } } });
      return { ok: true, deletedRounds: rounds.length, refundedEntries, drawnRoundsKept: await tx.lotteryRound.count({ where: { status: LotteryStatus.DRAWN } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Lottery reset failed' }); }
});
app.post('/v1/admin/lottery/:id/draw', { preHandler: requireAdmin }, async (request: any, reply) => {
  try { return await prisma.$transaction(async tx => {
    const round = await tx.lotteryRound.findUniqueOrThrow({ where: { id: request.params.id } }); const now = new Date();
    if (round.status !== LotteryStatus.OPEN || round.endsAt > now) throw new Error('Lottery is not ready to draw');
    const entries = await tx.lotteryEntry.findMany({ where: { roundId: round.id }, orderBy: { id: 'asc' } }); if (!entries.length) throw new Error('Lottery has no entries');
    const winner = entries[crypto.randomInt(entries.length)]; const reserve = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `SYSTEM:GEN:LOTTERY:${round.id}` } });
    const reserveTotals = await tx.ledgerEntry.aggregate({ where: { accountId: reserve.id }, _sum: { debit: true, credit: true } });
    if ((reserveTotals._sum.credit ?? 0n) - (reserveTotals._sum.debit ?? 0n) < BigInt(round.prizeGen)) throw new Error('Lottery reserve cannot cover the configured prize');
    const recipient = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${winner.userId}:GEN:AVAILABLE` } }); const proof = crypto.randomBytes(32).toString('hex');
    await postLedger({ idempotencyKey: `lottery-prize:${round.id}`, kind: LedgerKind.LOTTERY_PRIZE, referenceType: 'LotteryRound', referenceId: round.id, metadata: { winnerEntryId: winner.id, randomProof: proof }, postings: [{ accountId: reserve.id, debit: BigInt(round.prizeGen) }, { accountId: recipient.id, credit: BigInt(round.prizeGen) }] }, tx);
    const drawn = await tx.lotteryRound.update({ where: { id: round.id }, data: { status: LotteryStatus.DRAWN, winnerEntryId: winner.id, randomProof: proof, drawnAt: now } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'LOTTERY_DRAWN', entityType: 'LotteryRound', entityId: round.id, after: { winnerEntryId: winner.id, prizeGen: round.prizeGen, randomProof: proof } } }); return drawn;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Lottery draw failed' }); }
});
app.get('/v1/admin/users', { preHandler: requireAdmin }, async () => prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, telegramId: true, username: true, firstName: true, botStarts: true, lastStartedAt: true, role: true, createdAt: true } }).then(users => users.map(user => ({ ...user, telegramId: user.telegramId.toString() }))));
app.patch('/v1/admin/users/:id/role', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin access required' });
  const body = z.object({ role: z.enum(['USER', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'CONTENT_ADMIN', 'AUDITOR', 'DEVELOPER']) }).parse(request.body);
  return prisma.$transaction(async tx => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: request.params.id } });
    if (before.role === 'SUPER_ADMIN') throw new Error('Super admin cannot be demoted through delegated role management');
    const updated = await tx.user.update({ where: { id: before.id }, data: { role: body.role } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'USER_ROLE_UPDATED', entityType: 'User', entityId: before.id, before: { role: before.role }, after: { role: body.role } } });
    return { id: updated.id, role: updated.role };
  });
});
app.get('/v1/admin/tasks', { preHandler: requireAdmin }, async () => prisma.task.findMany({ orderBy: { startsAt: 'asc' }, include: { _count: { select: { claims: true } } } }));
app.post('/v1/admin/tasks', { preHandler: requireAdmin }, async (request: any) => {
  const input = taskInput.parse(request.body);
  if (input.dayNumber) input.isDaily = true;
  validateTaskConditions(input);
  if (input.endsAt && input.endsAt <= input.startsAt) throw new Error('Task end must be after its start');
  const task = await prisma.task.create({ data: { ...input, createdById: request.user.sub } });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'TASK_CREATED', entityType: 'Task', entityId: task.id, after: task } });
  return task;
});
app.patch('/v1/admin/tasks/:id', { preHandler: requireAdmin }, async (request: any) => {
  const input = taskInput.partial().parse(request.body);
  if (input.dayNumber) input.isDaily = true;
  const before = await prisma.task.findUniqueOrThrow({ where: { id: request.params.id } });
  validateTaskConditions({ ...before, ...input });
  const task = await prisma.task.update({ where: { id: before.id }, data: input });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'TASK_UPDATED', entityType: 'Task', entityId: task.id, before, after: task } });
  return task;
});
app.delete('/v1/admin/tasks/:id', { preHandler: requireAdmin }, async (request: any) => prisma.$transaction(async tx => {
  const before = await tx.task.findUniqueOrThrow({ where: { id: request.params.id } });
  await tx.task.update({ where: { id: before.id }, data: { status: 'ARCHIVED' } });
  await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'TASK_ARCHIVED', entityType: 'Task', entityId: before.id, before } });
  return { ok: true, archived: true };
}));
app.post('/v1/admin/tasks/archive-defaults', { preHandler: requireAdmin }, async (request: any, reply) => {
  const result = await prisma.$transaction(async tx => {
    const defaults = await tx.task.findMany({ where: { createdById: null, isDaily: true, status: { not: 'ARCHIVED' } }, select: { id: true, title: true } });
    if (defaults.length) await tx.task.updateMany({ where: { id: { in: defaults.map(task => task.id) } }, data: { status: 'ARCHIVED' } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'DEFAULT_TASKS_ARCHIVED', entityType: 'Task', entityId: 'DEFAULTS', after: { count: defaults.length } } });
    return { ok: true, archived: defaults.length };
  });
  return result;
});
app.put('/v1/admin/packages', { preHandler: requireAdmin }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'تغییر قیمت پکیج فقط برای سوپرادمین مجاز است.' });
  const parsed = packageCatalogInput.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: 'اطلاعات پکیج معتبر نیست؛ قیمت باید مثبت با حداکثر ۶ رقم اعشار و GEN عدد صحیح غیرمنفی باشد.', details: parsed.error.issues });
  const value = parsed.data;
  for (const item of value) {
    const rule = PACKAGE_RULES.find(rule => rule.code === item.code);
    if (!rule) return reply.code(422).send({ error: `کد پکیج ناشناخته است: ${item.code}` });
    if (parseUsdt(item.economicUsdc) <= rule.owner * 1000000n) return reply.code(422).send({ error: `قیمت پایه ${item.code} باید بیشتر از سهم ثابت مالک (${rule.owner.toString()} USDT) باشد.` });
  }
  return prisma.$transaction(async tx => {
    const before = await tx.systemSetting.findUnique({ where: { key: 'package_prices' } });
    const setting = await tx.systemSetting.upsert({ where: { key: 'package_prices' }, create: { key: 'package_prices', value }, update: { value } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'PACKAGE_PRICES_UPDATED', entityType: 'SystemSetting', entityId: setting.key, before: before?.value ?? Prisma.JsonNull, after: value } });
    return setting.value;
  });
});
app.get('/v1/admin/shop-items', { preHandler: requireAdmin }, async () => prisma.shopItem.findMany({ orderBy: { sortOrder: 'asc' } }));
app.post('/v1/admin/shop-items', { preHandler: requireAdmin }, async (request: any) => {
  const input = shopItemInput.parse(request.body); const item = await prisma.shopItem.create({ data: input });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'SHOP_ITEM_CREATED', entityType: 'ShopItem', entityId: item.id, after: item } }); return item;
});
app.patch('/v1/admin/shop-items/:id', { preHandler: requireAdmin }, async (request: any) => {
  const before = await prisma.shopItem.findUniqueOrThrow({ where: { id: request.params.id } }); const item = await prisma.shopItem.update({ where: { id: before.id }, data: shopItemInput.partial().parse(request.body) });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'SHOP_ITEM_UPDATED', entityType: 'ShopItem', entityId: item.id, before, after: item } }); return item;
});
app.delete('/v1/admin/shop-items/:id', { preHandler: requireAdmin }, async (request: any) => { const before = await prisma.shopItem.delete({ where: { id: request.params.id } }); await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'SHOP_ITEM_DELETED', entityType: 'ShopItem', entityId: before.id, before } }); return { ok: true }; });
app.get('/v1/admin/channels', { preHandler: requireAdmin }, async () => prisma.requiredChannel.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { memberships: true } } } }));
app.post('/v1/admin/channels', { preHandler: requireAdmin }, async (request: any) => {
  const input = channelInput.parse(request.body); const channel = await prisma.requiredChannel.upsert({ where: { chatId: input.chatId }, create: input, update: input });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'CHANNEL_SAVED', entityType: 'RequiredChannel', entityId: channel.id, after: channel } }); return channel;
});
app.delete('/v1/admin/channels/:id', { preHandler: requireAdmin }, async (request: any) => { const before = await prisma.requiredChannel.delete({ where: { id: request.params.id } }); await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'CHANNEL_DELETED', entityType: 'RequiredChannel', entityId: before.id, before } }); return { ok: true }; });
app.get('/v1/admin/withdrawals', { preHandler: requireFinanceAdmin }, async () => prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { telegramId: true, username: true, firstName: true } } } }).then(rows => rows.map(row => ({ ...row, amount: row.amount.toString(), fee: row.fee.toString(), netAmount: row.netAmount.toString(), user: { ...row.user, telegramId: row.user.telegramId.toString() } }))));
app.patch('/v1/admin/withdrawals/:id', { preHandler: requireFinanceAdmin }, async (request: any, reply) => { const body = z.object({ status: z.enum(['REVIEWING', 'APPROVED', 'REJECTED', 'PAID']), txHash: z.string().min(16).max(256).optional() }).parse(request.body); try { return await reviewWithdrawal(request.params.id, request.user.sub, body.status as any, body.txHash); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Withdrawal update failed' }); } });
app.get('/v1/admin/withdrawable-users', { preHandler: requireFinanceAdmin }, async () => prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, telegramId: true, username: true, firstName: true, referralCode: true, maxCap: true, capConsumed: true } }).then(rows => rows.map(row => ({ ...row, telegramId: row.telegramId.toString(), maxCap: row.maxCap.toString(), capConsumed: row.capConsumed.toString() }))));
app.post('/v1/admin/users/:id/withdrawable-credit', { preHandler: requireFinanceAdmin }, async (request: any, reply) => {
  const body = z.object({ amountUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/), note: z.string().trim().min(3).max(240), requestKey: z.string().uuid() }).parse(request.body);
  try {
    const amount = parseUsdt(body.amountUsdt);
    if (amount <= 0n) throw new Error('Credit amount must be positive');
    return financialJson(await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${request.params.id} FOR UPDATE`;
      const idempotencyKey = `admin-withdrawable-credit:${body.requestKey}`;
      const replay = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey } });
      if (replay) return { id: replay.id, credited: amount, replayed: true };
      const user = await tx.user.findUniqueOrThrow({ where: { id: request.params.id }, select: { id: true, maxCap: true, capConsumed: true } });
      const remainingCap = user.maxCap - user.capConsumed;
      if (amount > remainingCap) throw new Error('Credit exceeds the user’s remaining max cap');
      await tx.ledgerAccount.createMany({ data: [
        { userId: user.id, code: `USER:${user.id}:USDC:AVAILABLE`, currency: 'USDC', type: 'AVAILABLE' },
        { userId: user.id, code: `USER:${user.id}:USDC:HOLD`, currency: 'USDC', type: 'HOLD' },
      ], skipDuplicates: true });
      const source = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:USDC:ADMIN_CREDITS' }, create: { code: 'SYSTEM:USDC:ADMIN_CREDITS', currency: 'USDC', type: 'EXPENSE' }, update: {} });
      const recipient = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${user.id}:USDC:AVAILABLE` } });
      const ledger = await postLedger({ idempotencyKey, kind: LedgerKind.ADJUSTMENT, referenceType: 'AdminWithdrawableCredit', referenceId: user.id, metadata: { note: body.note, actorId: request.user.sub }, postings: [{ accountId: source.id, debit: amount }, { accountId: recipient.id, credit: amount }] }, tx);
      await tx.user.update({ where: { id: user.id }, data: { capConsumed: { increment: amount } } });
      await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'WITHDRAWABLE_USDT_CREDITED', entityType: 'User', entityId: user.id, after: { amount: amount.toString(), note: body.note, ledgerTransactionId: ledger.id } } });
      return { id: ledger.id, credited: amount, remainingCap: remainingCap - amount, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'User credit failed' }); }
});
app.get('/v1/admin/payments', { preHandler: requireFinanceAdmin }, async () => financialJson(await prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })));
app.patch('/v1/admin/payments/:id', { preHandler: requireFinanceAdmin }, async (request: any, reply) => {
  const body = z.object({ status: z.enum(['CONFIRMED', 'REJECTED']) }).parse(request.body);
  try {
    if (body.status === 'CONFIRMED') return await confirmPayment(request.params.id, request.user.sub);
    return await prisma.$transaction(async tx => { const before = await tx.payment.findUniqueOrThrow({ where: { id: request.params.id } }); if (before.status !== 'PENDING') throw new Error('Payment is already final'); const payment = await tx.payment.update({ where: { id: before.id }, data: { status: 'REJECTED' } }); await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'PAYMENT_REJECTED', entityType: 'Payment', entityId: before.id, before: { status: before.status }, after: { status: 'REJECTED' } } }); return { id: payment.id, status: payment.status, packageCode: payment.packageCode }; });
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Payment update failed' }); }
});
app.post('/v1/admin/users/:id/package', { preHandler: requireAdmin }, async (request: any) => {
  const body = z.object({ packageCode: z.string().min(2).max(32), depositedUsdc: z.string().regex(/^\d+$/).default('0') }).parse(request.body); const user = await prisma.user.update({ where: { id: request.params.id }, data: { activePackageCode: body.packageCode, packageActivatedAt: new Date(), totalDeposited: { increment: BigInt(body.depositedUsdc) } } });
  await prisma.auditEvent.create({ data: { actorId: request.user.sub, action: 'PACKAGE_MANUALLY_CONFIRMED', entityType: 'User', entityId: user.id, after: { packageCode: body.packageCode } } }); return { id: user.id, packageCode: user.activePackageCode };
});
app.post('/v1/admin/users/:id/vouchers', { preHandler: requireFinanceAdmin }, async (request: any, reply) => { const body = z.object({ delta: z.number().int().min(-10000).max(10000), note: z.string().min(3).max(240) }).parse(request.body); try { return await prisma.$transaction(async tx => { const user = await tx.user.update({ where: { id: request.params.id }, data: { vouchers: { increment: body.delta } } }); if (user.vouchers < 0) throw new Error('Voucher balance cannot be negative'); await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'VOUCHERS_ADJUSTED', entityType: 'User', entityId: user.id, after: { delta: body.delta, note: body.note } } }); return { id: user.id, vouchers: user.vouchers }; }); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Voucher update failed' }); } });
app.post('/v1/wallets/challenge', { preHandler: requireUser }, async (request: any) => {
  return walletChallenge(request.user.sub);
});
app.post('/v1/wallets/verify', { preHandler: requireUser }, async (request: any, reply) => {
  try { return await saveProvenWallet(request.user.sub, walletProofInput.parse(request.body), new URL(env.APP_ORIGIN).host, env.TON_NETWORK === 'mainnet' ? '-239' : '-3'); }
  catch(e) { return reply.code(422).send({error:e instanceof Error?e.message:'تأیید ولت ناموفق بود'}); }
});
app.post('/v1/withdrawals', { preHandler: requireUser }, async (request: any, reply) => {
  const body = z.object({ amount: z.string().regex(/^\d+$/), destination: z.string().min(10).max(128), idempotencyKey: z.string().uuid() }).parse(request.body);
  try {
    const withdrawal = await requestWithdrawal(request.user.sub, BigInt(body.amount), body.destination, body.idempotencyKey);
    // Do not wait for the next polling interval for a newly approved payout.
    // Signing, broadcast, and chain confirmation remain owned by the worker.
    if (payoutAutomationReady && withdrawal.status === 'APPROVED') void payoutWorker?.tick();
    return { ...withdrawal, automatic: payoutAutomationReady };
  }
  catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Withdrawal failed' }); }
});
app.get('/v1/me/withdrawals', { preHandler: requireUser }, async (request: any) => {
  const userId = request.user.sub;
  await ensureUserAccounts(userId);
  const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:USDC:AVAILABLE` } });
  const [wallet, rows, balance] = await Promise.all([prisma.wallet.findUnique({ where: { userId } }), prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }), accountBalance(account.id)]);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [user, usage] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } }),
    prisma.withdrawal.aggregate({ where: { userId, createdAt: { gte: today }, status: { notIn: ['REJECTED', 'CANCELLED'] } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const remaining = dailyCapForXp(user.xp) - (usage._sum.amount ?? 0n);
  const maxAmount = usage._count._all >= economics.withdrawal.maximumPerDay || remaining <= 0n || balance <= 0n ? 0n : balance < remaining ? balance : remaining;
  return financialJson({ wallet: wallet ? { ...wallet, address: Address.parse(wallet.address).toRawString() } : null, rows, balance, maxAmount, usedToday: usage._count._all, minimum: economics.withdrawal.minimumUsdc, feeBps: economics.withdrawal.feeBps, maximumPerDay: economics.withdrawal.maximumPerDay, automatic: payoutAutomationReady });
});

await seedCoreContent();
const payoutWorker = startPayoutWorker(app.log);
const paymentWorker = startPaymentWorker();
const auctionWorker = createWorker('auctions', 1000, processAuctions, app.log);
auctionWorker?.start();
app.get('/v1/auctions', { preHandler: requireUser }, async (request: any) => {
  const rooms = await prisma.auction.findMany({ where: { status: { in: ['OPEN', 'AWAITING', 'CLOSED'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, series: true, round: true, entryUsdt: true, autoAdvance: true, bidGen: true, prizeUsdt: true, prizeGen: true, prizeXp: true, remainingSeconds: true, endsAt: true, status: true, _count: { select: { bids: { where: { userId: request.user.sub } } } }, awards: true } });
  const series = [...new Set(rooms.map(room => room.series ?? `ROOM:${room.id}`))];
  const passes = series.length ? await prisma.auctionEntryPass.findMany({ where: { userId: request.user.sub, series: { in: series } }, select: { series: true, roomsRemaining: true } }) : [];
  const passesBySeries = new Map(passes.map(pass => [pass.series, pass.roomsRemaining]));
  return financialJson(rooms.map(room => ({ ...room, entryPaid: (passesBySeries.get(room.series ?? `ROOM:${room.id}`) ?? 0) > 0, entryCredits: passesBySeries.get(room.series ?? `ROOM:${room.id}`) ?? 0 })));
});
app.get('/v1/auction-packages', { preHandler: requireUser }, async (request: any) => {
  const prices = await readAuctionPackagePrices();
  const passes = await prisma.auctionEntryPass.findMany({ where: { userId: request.user.sub, series: { in: ['A', 'B', 'C'] } }, select: { series: true, roomsRemaining: true } });
  const credits = new Map(passes.map(pass => [pass.series, pass.roomsRemaining]));
  return financialJson(['A', 'B', 'C'].map(series => ({ series, priceUsdt: parseUsdt(prices[series as 'A' | 'B' | 'C']), hallsIncluded: 2, roomsRemaining: credits.get(series) ?? 0 })));
});
app.post('/v1/auction-packages/:series/purchase', { preHandler: requireUser }, async (request: any, reply) => {
  const series = z.enum(['A', 'B', 'C']).safeParse(String(request.params.series).toUpperCase());
  const body = z.object({ requestKey: z.string().uuid() }).parse(request.body);
  if (!series.success) return reply.code(422).send({ error: 'Unknown lottery package' });
  try {
    const prices = await readAuctionPackagePrices();
    const price = parseUsdt(prices[series.data]);
    if (price <= 0n) throw new Error('Lottery package price must be positive');
    return financialJson(await purchaseAuctionPackage(request.user.sub, series.data, price, body.requestKey));
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Lottery package purchase failed', requestId: request.id }); }
});
app.get('/v1/admin/auction-package-prices', { preHandler: requireAdmin }, async () => readAuctionPackagePrices());
app.put('/v1/admin/auction-package-prices', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin required' });
  const prices = auctionPackagePricesInput.parse(request.body);
  if (Object.values(prices).some(price => parseUsdt(price) <= 0n)) return reply.code(422).send({ error: 'Lottery package prices must be positive' });
  return prisma.$transaction(async tx => {
    await tx.systemSetting.upsert({ where: { key: 'auction_package_prices' }, create: { key: 'auction_package_prices', value: prices }, update: { value: prices } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'AUCTION_PACKAGE_PRICES_UPDATED', entityType: 'SystemSetting', entityId: 'auction_package_prices', after: prices } });
    return prices;
  });
});
app.post('/v1/admin/auctions', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'فقط سوپرادمین می‌تواند اتاق بسازد.' });
  const input = z.object({ title: z.string().min(2).max(120), bidGen: z.number().int().min(0).max(1000000), prizeUsdt: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), entryUsdt: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), prizeGen: z.number().int().min(0).max(1000000), prizeXp: z.number().int().min(0).max(1000000), durationSeconds: z.number().int().min(10).max(2592000) }).parse(request.body);
  const { durationSeconds, prizeUsdt, entryUsdt, ...values } = input;
  const hall = /^([CBA])\s*(\d+)$/i.exec(input.title.trim());
  const series = hall?.[1].toUpperCase() ?? null, round = hall ? Number(hall[2]) : null;
  try { return financialJson(await createAuction(request.user.sub, { ...values, title: hall ? `${series}${round}` : input.title.trim(), series, round, entryUsdt: parseUsdt(entryUsdt), autoAdvance: Boolean(hall), remainingSeconds: durationSeconds, endsAt: new Date(Date.now() + durationSeconds * 1000), prizeUsdt: parseUsdt(prizeUsdt) })); }
  catch (error) {
    if (error instanceof Error && error.message === 'Insufficient auction funding') return reply.code(422).send({ error: 'موجودی ثبت‌شده استخر پاداش برای رزرو جایزه کافی نیست. اتاق ساخته نشد؛ مبلغ جایزه یا موجودی استخر را بررسی کنید.' });
    throw error;
  }
});
app.delete('/v1/admin/auctions/:id', { preHandler: requireAdmin }, async (request: any, reply) => {
  if (!['SUPER_ADMIN', 'CONTENT_ADMIN'].includes(request.user.role)) return reply.code(403).send({ error: 'دسترسی مدیریت اتاق‌ها لازم است.' });
  try { return await deleteUnusedAuction(request.user.sub, request.params.id); }
  catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'حذف اتاق ناموفق بود.' }); }
});
// POST alias avoids hosts that block DELETE requests from browser clients.
app.post('/v1/admin/auctions/:id/cancel', { preHandler: requireAdmin }, async (request: any, reply) => {
  if (!['SUPER_ADMIN', 'CONTENT_ADMIN'].includes(request.user.role)) return reply.code(403).send({ error: 'دسترسی مدیریت اتاق‌ها لازم است.' });
  try { return await deleteUnusedAuction(request.user.sub, request.params.id); }
  catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'حذف اتاق ناموفق بود.' }); }
});
app.post('/v1/admin/auctions/reset', { preHandler: requireUser }, async (request: any, reply) => {
  if (request.user.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'فقط سوپرادمین می‌تواند تالارها را ریست کند.' });
  const body = z.object({ confirmation: z.literal('RESET AUCTION ROOMS') }).parse(request.body);
  return prisma.$transaction(async tx => {
    const rooms = await tx.auction.findMany({ where: { status: { in: ['OPEN', 'AWAITING', 'CLOSED'] } }, select: { id: true } });
    if (rooms.length) await tx.auction.updateMany({ where: { id: { in: rooms.map(room => room.id) } }, data: { status: 'CANCELLED' } });
    await tx.auditEvent.create({ data: { actorId: request.user.sub, action: 'AUCTION_ROOMS_RESET', entityType: 'Auction', entityId: 'ALL', after: { cancelledRooms: rooms.length, confirmation: body.confirmation } } });
    return { ok: true, cancelledRooms: rooms.length };
  });
});
app.post('/v1/auctions/:id/bids', { preHandler: requireUser }, async (request: any, reply) => {
  const input = z.object({ cents: z.string().regex(/^\d{1,12}$/), requestKey: z.string().uuid() }).parse(request.body);
  try { return financialJson(await placeAuctionBid(request.user.sub, request.params.id, BigInt(input.cents), input.requestKey)); }
  catch (error) {
    const expected = ['Invalid bid', 'Conflicting bid retry', 'Auction closed', 'Active package required', 'Insufficient USDT for hall entry', 'Insufficient GEN'];
    if (error instanceof Error && expected.includes(error.message)) return reply.code(422).send({ error: error.message, requestId: request.id });
    throw error;
  }
});
app.post('/v1/auctions/awards/:id/payment', { preHandler: requireUser }, async (request: any, reply) => {
  if (!env.PLATFORM_TREASURY_ADDRESS || !env.TON_USDC_MASTER_ADDRESS) return reply.code(503).send({ error: 'Payment configuration is not ready' });
  const payment = await auctionPaymentIntent(request.user.sub, request.params.id);
  return { id: payment.id, amountUsdc: formatUsdt(payment.expectedAmount), treasuryAddress: env.PLATFORM_TREASURY_ADDRESS, jettonMasterAddress: env.TON_USDC_MASTER_ADDRESS, expiresAt: payment.expiresAt };
});
app.post('/v1/auctions/awards/:id/claim', { preHandler: requireUser }, async (request: any, reply) => {
  try { return financialJson(await claimAuctionAward(request.user.sub, request.params.id)); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Award claim failed';
    return reply.code(422).send({ error: message, requestId: request.id });
  }
});
app.post('/v1/auctions/awards/:id/reveal', { preHandler: requireUser }, async (request: any, reply) => {
  try { return await revealAuctionAward(request.user.sub, request.params.id); }
  catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Prize reveal failed' }); }
});
const seasonWorker = env.AUTOMATION_ENABLED ? createWorker('season-days', 30000, processSeasonDays, app.log) : undefined;
seasonWorker?.start();
app.post('/v1/admin/progress/reset', { preHandler: requireAdmin }, async (request: any) => {
  const body = z.object({ confirmation: z.literal('RESET ALL PROGRESS'), requestKey: z.string().uuid() }).parse(request.body);
  return resetSeasonProgress(request.user.sub, body.requestKey);
});
app.get('/v1/me/seasons', { preHandler: requireUser }, async (request: any) => financialJson(await prisma.seasonEnrollment.findMany({ where: { userId: request.user.sub }, include: { days: { where: { number: { gt: 0 } }, orderBy: { number: 'asc' } } } })));
app.post('/v1/seasons/days/:id/gift', { preHandler: requireUser }, async (request: any) => financialJson(await claimSeasonGift(request.user.sub, request.params.id)));
app.post('/v1/seasons/days/:id/grace', { preHandler: requireUser }, async (request: any) => financialJson(await useSeasonGrace(request.user.sub, request.params.id)));
const binaryWorker = env.AUTOMATION_ENABLED ? createWorker('binary-settlement', 30000, processBinaryQueue, app.log) : undefined;
binaryWorker?.start();
app.get('/v1/me/binary', { preHandler: requireUser }, async (request: any) => financialJson({
  position: await prisma.binaryPosition.findUnique({ where: { userId: request.user.sub } }),
  receipts: await prisma.binaryReceipt.findMany({ where: { userId: request.user.sub }, orderBy: { createdAt: 'desc' }, take: 100 }),
}));
app.get('/v1/admin/binary-receipts', { preHandler: requireFinanceAdmin }, async () => financialJson(await prisma.binaryReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })));
app.get('/v1/admin/workers', { preHandler: requireFinanceAdmin }, async () => ({
  automationEnabled: env.AUTOMATION_ENABLED,
  payoutMode: 'MANUAL',
  workers: [payoutWorker?.state ?? { name: 'payout', disabled: true }, paymentWorker?.state ?? { name: 'submitted-payments', disabled: true }, binaryWorker?.state ?? { name: 'binary-settlement', disabled: true }, seasonWorker?.state ?? { name: 'season-days', disabled: true }, auctionWorker?.state ?? { name: 'auctions', disabled: true }],
  economicsV2Live: false,
}));
app.addHook('onClose', async () => { await Promise.all([payoutWorker?.stop(), paymentWorker?.stop(), binaryWorker?.stop(), seasonWorker?.stop(), auctionWorker?.stop()]); await prisma.$disconnect(); });
let closing = false;
const shutdown = () => { if (closing) return; closing = true; void app.close().catch(() => { process.exitCode = 1; }); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
