import { prisma } from '../prisma.js';

/**
 * Removes runtime/user data while retaining the package catalogue and its
 * opening-price settings. This intentionally also removes administrators;
 * ADMIN_TELEGRAM_IDS bootstraps the super admin again after /start.
 */
export async function resetDatabasePreservingPackages() {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE
      "PayoutJob", "Withdrawal", "LedgerEntry", "LedgerTransaction", "LedgerAccount",
      "Payment", "BinaryReceipt", "BinaryVolume", "BinaryPosition", "RewardReceipt",
      "ReferralCommission", "AuctionBid", "AuctionAward", "Auction", "LotteryEntry",
      "LotteryRound", "WalletChallenge", "Wallet", "TaskClaim", "ShopPurchase",
      "ChannelMembership", "SeasonDay", "SeasonEnrollment", "GameActivity", "SupportTicket",
      "UserNotification", "AuditEvent", "User", "Task", "ShopItem", "RequiredChannel"
      RESTART IDENTITY CASCADE`);

    await tx.systemSetting.deleteMany({ where: {
      key: { notIn: ['package_prices', 'opening_started_at', 'opening_extra_days'] }
    } });
  }, { timeout: 30_000 });
}
