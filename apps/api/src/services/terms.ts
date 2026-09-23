import { createHash } from 'node:crypto';
import { prisma } from '../prisma.js';
export const DEFAULT_TERMS_TEXT = `15. Risks

Users acknowledge that Web3 and digital asset activities involve risks, including:

Asset price volatility.

Blockchain or Network Failure.

Smart Contract Risk.

Wallet Risk.

Cyberattacks.

Liquidity Risk.

User error.

Regulatory changes.

Loss of access to digital assets.

Users should only use applicable services after considering these risks.

16. Limitation of Liability

To the maximum extent permitted by applicable law, GENYX is not responsible for losses caused by events outside its reasonable control, including Blockchain or Telegram disruptions, Internet failures, Cyberattacks, Wallet Provider problems, regulatory changes, or Force Majeure events.
Nothing in these Terms excludes rights or liabilities that cannot legally be excluded or limited.

17. Privacy, Taxes and Regional Restrictions

User information is processed according to the GENYX Privacy Policy and may be used where necessary for service delivery, security, authentication, fraud prevention, and legal compliance.
Certain GENYX services may be unavailable or restricted in particular countries or regions. Users are responsible for ensuring that their use of GENYX is lawful in their jurisdiction.
Users are responsible for any applicable taxes, duties, reporting obligations, or other legal requirements relating to their use of GENYX or receipt of digital assets or Rewards.

18. Changes to These Terms

GENYX may update these Terms when necessary.
The updated version becomes effective upon publication or on the effective date stated by GENYX.
Continued use of GENYX after the effective date constitutes acceptance of the updated Terms to the extent permitted by applicable law.

19. Official Support

Users should contact GENYX only through official Support channels.
GENYX will never request:
Password / Seed Phrase / Recovery Phrase / Private Key
from a User.
Any person requesting such information while claiming to represent GENYX should be treated as suspicious and reported through official Support.

20. Final User Confirmation

By selecting the confirmation checkbox below, the User confirms that they:

Have read and understood these Terms.

Accept the rules governing GENYX.

Understand the relevant Web3 and digital asset risks.

Accept responsibility for their Account activity.

Agree to the applicable Anti-Fraud and Audit systems.

Understand that violations may result in Warning, Restriction, Suspension, or Termination.

Failure to accept these Terms means the User may not use GENYX services.

GENYX

PLAY · BUILD · RISE

Earn through action. Learn through experience. Build your future.`;
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
