import { createHash } from 'node:crypto';
import { prisma } from '../prisma.js';
export const DEFAULT_TERMS_TEXT = `GENYX — TERMS OF SERVICE

Last Updated: September 6, 2026

1. Acceptance

By using GENYX, you agree to these Terms. If you disagree, do not use the Platform.

2. Accounts & Security

Fake accounts, fraudulent referrals, bots, and system manipulation are prohibited. Never share your password or wallet recovery phrase.

3. Missions & Rewards

Missions must be completed honestly. XP, Levels, Rewards, and commissions are subject to Platform rules and are not guaranteed.

4. Packages & Cancellation

Package cancellation is permitted only within the first two months after purchase. Paid commissions and daily profits received will be deducted from the original investment. Any remaining balance will be refunded to the User’s Wallet. No refund is due if deductions equal or exceed the original investment.

5. Max Cap & Income

Rewards and commissions are subject to Max Cap and Platform rules. GENYX does not guarantee income, profit, or financial returns.

6. Wallet & Digital Assets

Blockchain transactions may be irreversible. Users must verify addresses, networks, amounts, and fees. Digital assets involve financial and technical risks.

7. Fraud & Violations

GENYX may investigate suspicious activity and apply warnings, restrictions, suspension, or account termination depending on the severity of violations.

8. Platform & Privacy

GENYX may update its features and rules. User information is handled according to the Privacy Policy. Users must comply with applicable laws.

9. Final Agreement

By selecting “I Agree,” you confirm that you understand and accept these Terms, including the cancellation policy, Platform rules, and digital asset risks.
GENYX — MORE THAN A GAME`;
export async function currentTerms() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'terms_text' } });
  const text = typeof setting?.value === 'string' ? setting.value : DEFAULT_TERMS_TEXT;
  return { text, version: createHash('sha256').update(text).digest('hex') };
}
export async function termsStatus(userId: string) {
  const terms = await currentTerms();
  const accepted = Boolean(await prisma.auditEvent.findFirst({ where: { actorId: userId, action: 'TERMS_ACCEPTED', entityId: terms.version } }));
  return { ...terms, accepted };
}
