import { createHash } from 'node:crypto';
import { prisma } from '../prisma.js';
export async function currentTerms() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'terms_text' } });
  const text = typeof setting?.value === 'string' ? setting.value : 'GENYX is a centralized platform. Management enforces account, task, reward and restriction rules. Mandatory legal rights remain unaffected. Contact support for the complete terms.';
  return { text, version: createHash('sha256').update(text).digest('hex') };
}
export async function termsStatus(userId: string) {
  const terms = await currentTerms();
  const accepted = Boolean(await prisma.auditEvent.findFirst({ where: { actorId: userId, action: 'TERMS_ACCEPTED', entityId: terms.version } }));
  return { ...terms, accepted };
}
