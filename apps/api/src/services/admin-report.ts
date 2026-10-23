import { prisma } from '../prisma.js';
import { buildXlsx, type XlsxSheet } from '../domain/xlsx.js';
import { rankName } from '../domain/ranks.js';
import { rankLevels } from './ranks.js';

const LIMIT = 50_000;

/** The full admin workbook: summary, users, money flows, investments, lottery and ledger. */
export async function buildAdminWorkbook(now = new Date()) {
  const [users, payments, withdrawals, investments, auctions, awards, balances, ledger] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' }, take: LIMIT, include: { wallet: { select: { address: true } }, referredBy: { select: { telegramId: true, username: true } } } }),
    prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: LIMIT }),
    prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: LIMIT, include: { user: { select: { telegramId: true, username: true } }, payoutJob: { select: { status: true, attempts: true, lastError: true, confirmedAt: true } } } }),
    prisma.investment.findMany({ orderBy: { createdAt: 'desc' }, take: LIMIT, include: { user: { select: { telegramId: true, username: true } } } }),
    prisma.auction.findMany({ orderBy: { endsAt: 'desc' }, take: LIMIT, include: { _count: { select: { bids: true } } } }),
    prisma.auctionAward.findMany({ orderBy: { expiresAt: 'desc' }, take: LIMIT, include: { auction: { select: { title: true } } } }),
    prisma.$queryRaw<{ userId: string; code: string; balance: bigint }[]>`
      SELECT a."userId", a.code, COALESCE(SUM(e.credit - e.debit), 0)::bigint AS balance
      FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
      WHERE a."userId" IS NOT NULL GROUP BY a.id`,
    prisma.ledgerEntry.findMany({ orderBy: { transaction: { createdAt: 'desc' } }, take: LIMIT, include: { account: { select: { code: true, currency: true } }, transaction: { select: { kind: true, referenceType: true, referenceId: true, createdAt: true } } } }),
  ]);

  const levels = await rankLevels(prisma, users.map(user => user.id));
  const balance = new Map(balances.map(row => [row.code, row.balance]));
  const of = (userId: string, suffix: string) => balance.get(`USER:${userId}:${suffix}`) ?? 0n;
  const who = new Map(users.map(user => [user.id, user]));
  const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

  const confirmed = payments.filter(row => row.status === 'CONFIRMED');
  const paid = withdrawals.filter(row => row.status === 'PAID');
  const open = withdrawals.filter(row => ['REQUESTED', 'REVIEWING', 'APPROVED'].includes(row.status));
  const activeInvestments = investments.filter(row => row.status === 'ACTIVE');
  const byPurpose = new Map<string, bigint>();
  for (const row of confirmed) byPurpose.set(row.purpose, (byPurpose.get(row.purpose) ?? 0n) + row.expectedAmount);

  const summary: XlsxSheet = {
    name: 'Summary',
    columns: [{ header: 'Metric', width: 42 }, { header: 'Value', width: 22 }, { header: 'Unit', width: 10 }],
    rows: [
      ['Report generated (UTC)', now.toISOString().replace('T', ' ').slice(0, 19), ''],
      ['Users', users.length, ''],
      ['Users with an active package', users.filter(user => user.activePackageCode).length, ''],
      ['Confirmed payments', confirmed.length, ''],
      ['Confirmed payment volume', Number(sum(confirmed.map(row => row.expectedAmount))) / 1e6, 'USDT'],
      ...[...byPurpose].map(([purpose, amount]) => [`  of which ${purpose}`, Number(amount) / 1e6, 'USDT']),
      ['Pending payments', payments.filter(row => row.status === 'PENDING').length, ''],
      ['Withdrawals paid', paid.length, ''],
      ['Withdrawals paid (net sent)', Number(sum(paid.map(row => row.netAmount))) / 1e6, 'USDT'],
      ['Withdrawal fees earned', Number(sum(paid.map(row => row.fee))) / 1e6, 'USDT'],
      ['Withdrawals waiting', open.length, ''],
      ['Withdrawals waiting (amount)', Number(sum(open.map(row => row.amount))) / 1e6, 'USDT'],
      ['User USDT available (total)', Number(sum(users.map(user => of(user.id, 'USDC:AVAILABLE')))) / 1e6, 'USDT'],
      ['User USDT on hold (total)', Number(sum(users.map(user => of(user.id, 'USDC:HOLD')))) / 1e6, 'USDT'],
      ['User GEN (total)', Number(sum(users.map(user => of(user.id, 'GEN:AVAILABLE')))), 'GEN'],
      ['Active investments', activeInvestments.length, ''],
      ['Active investment principal', Number(sum(activeInvestments.map(row => row.principal))) / 1e6, 'USDT'],
      ['Investment profit locked (to be paid)', Number(sum(investments.map(row => row.profitLocked))) / 1e6, 'USDT'],
      ['Investment profit earned (all time)', Number(sum(investments.map(row => row.profitPaid))) / 1e6, 'USDT'],
      ['Lottery halls', auctions.length, ''],
      ['Lottery prizes claimed', awards.filter(row => row.status === 'CLAIMED').length, ''],
    ],
  };

  const userSheet: XlsxSheet = {
    name: 'Users',
    columns: [
      { header: 'Telegram ID', width: 14 }, { header: 'Username', width: 18 }, { header: 'Name', width: 22 }, { header: 'Role', width: 12 },
      { header: 'Level', type: 'int', width: 8 }, { header: 'Rank', width: 14 }, { header: 'Package', width: 12 }, { header: 'Package since', type: 'date' },
      { header: 'USDT available', type: 'usdt' }, { header: 'USDT on hold', type: 'usdt' }, { header: 'Investment profit locked', type: 'usdt', width: 20 },
      { header: 'GEN', type: 'int' }, { header: 'Total deposited', type: 'usdt' }, { header: 'Total withdrawn', type: 'usdt' },
      { header: 'Max cap', type: 'usdt' }, { header: 'Cap used', type: 'usdt' }, { header: 'Vouchers', type: 'int', width: 10 },
      { header: 'Wallet', width: 50 }, { header: 'Referral code', width: 14 }, { header: 'Sponsor', width: 18 }, { header: 'Joined', type: 'date' }, { header: 'Last /start', type: 'date' },
    ],
    rows: users.map(user => {
      const level = levels.get(user.id) ?? 0;
      return [
        user.telegramId.toString(), user.username ? `@${user.username}` : '', user.displayName || user.firstName || '', user.role,
        level, rankName(level), user.activePackageCode ?? '', user.packageActivatedAt,
        of(user.id, 'USDC:AVAILABLE'), of(user.id, 'USDC:HOLD'), of(user.id, 'USDC:INVESTMENT'),
        of(user.id, 'GEN:AVAILABLE'), user.totalDeposited, user.totalWithdrawn, user.maxCap, user.capConsumed, user.vouchers,
        user.wallet?.address ?? '', user.referralCode ?? '', user.referredBy ? (user.referredBy.username ? `@${user.referredBy.username}` : user.referredBy.telegramId.toString()) : '',
        user.createdAt, user.lastStartedAt,
      ];
    }),
  };

  const byId = (userId: string) => { const user = who.get(userId); return user ? userCells(user) : [userId, '']; };
  const userCols = [{ header: 'Telegram ID', width: 14 }, { header: 'Username', width: 18 }] as const;
  const userCells = (user: { telegramId: bigint; username: string | null }) => [user.telegramId.toString(), user.username ? `@${user.username}` : ''];

  const paymentSheet: XlsxSheet = {
    name: 'Payments',
    columns: [...userCols, { header: 'Purpose', width: 14 }, { header: 'Product', width: 14 }, { header: 'Amount', type: 'usdt' }, { header: 'Status', width: 12 },
      { header: 'Binary allocation', type: 'usdt' }, { header: 'GEN quoted', type: 'int' }, { header: 'Transaction hash', width: 66 },
      { header: 'Created', type: 'date' }, { header: 'Confirmed', type: 'date' }, { header: 'Expires', type: 'date' }, { header: 'Payment ID', width: 28 }],
    rows: payments.map(row => [...byId(row.userId), row.purpose, row.packageCode, row.expectedAmount, row.status, row.quotedBinary, row.quotedGen,
      row.chainTxHash ?? '', row.createdAt, row.confirmedAt, row.expiresAt, row.id]),
  };

  const withdrawalSheet: XlsxSheet = {
    name: 'Withdrawals',
    columns: [...userCols, { header: 'Amount', type: 'usdt' }, { header: 'Fee', type: 'usdt' }, { header: 'Net sent', type: 'usdt' }, { header: 'Status', width: 14 },
      { header: 'Payout job', width: 14 }, { header: 'Attempts', type: 'int', width: 9 }, { header: 'Last error', width: 30 }, { header: 'Destination', width: 50 },
      { header: 'Transaction hash', width: 66 }, { header: 'Requested', type: 'date' }, { header: 'Updated', type: 'date' }, { header: 'Withdrawal ID', width: 28 }],
    rows: withdrawals.map(row => [...userCells(row.user), row.amount, row.fee, row.netAmount, row.status, row.payoutJob?.status ?? '', row.payoutJob?.attempts,
      row.payoutJob?.lastError ?? '', row.destination, row.txHash ?? '', row.createdAt, row.updatedAt, row.id]),
  };

  const investmentSheet: XlsxSheet = {
    name: 'Investments',
    columns: [...userCols, { header: 'Plan', width: 10 }, { header: 'Principal', type: 'usdt' }, { header: 'Status', width: 12 },
      { header: 'Monthly profit', type: 'usdt' }, { header: 'Monthly tokens', type: 'int' }, { header: 'Max profit', type: 'usdt' }, { header: 'Max cap', type: 'usdt' },
      { header: 'Profit earned', type: 'usdt' }, { header: 'Tokens paid', type: 'int' }, { header: 'Max Profit progress', type: 'usdt', width: 18 }, { header: 'Progress %', type: 'percent', width: 11 },
      { header: 'Profit locked', type: 'usdt' }, { header: 'Profit released', type: 'date' }, { header: 'Fixed cycles', type: 'int', width: 11 }, { header: 'Commission', type: 'usdt' },
      { header: 'Settled through', width: 14 }, { header: 'Started', type: 'date' }, { header: 'Cancelled', type: 'date' }, { header: 'Refund', type: 'usdt' }, { header: 'Investment ID', width: 28 }],
    rows: investments.map(row => {
      const target = row.maxProfit < row.maxCap ? row.maxProfit : row.maxCap;
      return [...userCells(row.user), row.planCode, row.principal, row.status, row.monthlyProfit, row.monthlyTokens, row.maxProfit, row.maxCap,
        row.profitPaid, row.tokensPaid, row.valueConsumed, target > 0n ? Number(row.valueConsumed) / Number(target) : 0,
        row.profitLocked, row.profitReleasedAt, row.fixedCycles, row.commissionAllocation, row.settledThrough ?? '', row.startedAt, row.cancelledAt, row.refundAmount, row.id];
    }),
  };

  const lotterySheet: XlsxSheet = {
    name: 'Lottery halls',
    columns: [{ header: 'Hall', width: 18 }, { header: 'Series', width: 8 }, { header: 'Round', type: 'int', width: 8 }, { header: 'Status', width: 12 },
      { header: 'Pack price', type: 'usdt' }, { header: 'Bid (GEN)', type: 'int' }, { header: 'Prize', type: 'usdt' }, { header: 'Prize GEN', type: 'int' },
      { header: 'Bids', type: 'int', width: 8 }, { header: 'Ends', type: 'date' }, { header: 'Created', type: 'date' }, { header: 'Hall ID', width: 28 }],
    rows: auctions.map(row => [row.title, row.series ?? '', row.round, row.status, row.entryUsdt, row.bidGen, row.prizeUsdt, row.prizeGen, row._count.bids, row.endsAt, row.createdAt, row.id]),
  };

  const awardSheet: XlsxSheet = {
    name: 'Lottery prizes',
    columns: [{ header: 'Hall', width: 18 }, ...userCols, { header: 'Winning bid', type: 'int' }, { header: 'Prize', type: 'usdt' }, { header: 'Prize GEN', type: 'int' },
      { header: 'Status', width: 12 }, { header: 'Revealed', type: 'date' }, { header: 'Claim by', type: 'date' }],
    rows: awards.map(row => {
      const user = who.get(row.userId);
      return [row.auction.title, user?.telegramId.toString() ?? row.userId, user?.username ? `@${user.username}` : '', row.cents, row.prizeUsdt, row.prizeGen, row.status, row.revealedAt, row.expiresAt];
    }),
  };

  const ledgerSheet: XlsxSheet = {
    name: 'Ledger',
    columns: [{ header: 'Time', type: 'date' }, { header: 'Kind', width: 22 }, { header: 'Account', width: 46 }, { header: 'Currency', width: 9 },
      { header: 'Debit', type: 'int' }, { header: 'Credit', type: 'int' }, { header: 'Amount (USDT / GEN)', type: 'number', width: 18 }, { header: 'Reference', width: 14 }, { header: 'Reference ID', width: 28 }],
    // Debit/credit stay in atomic units so the sheet reconciles exactly; the amount column is human-readable.
    rows: ledger.map(row => {
      const net = row.credit - row.debit;
      return [row.transaction.createdAt, row.transaction.kind, row.account.code, row.account.currency, row.debit, row.credit,
        row.account.currency === 'USDC' ? Number(net) / 1e6 : Number(net), row.transaction.referenceType, row.transaction.referenceId];
    }),
  };

  return buildXlsx([summary, userSheet, paymentSheet, withdrawalSheet, investmentSheet, lotterySheet, awardSheet, ledgerSheet]);
}
