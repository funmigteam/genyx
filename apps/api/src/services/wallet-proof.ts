import { createHash, randomBytes } from 'node:crypto';
import { Address, Cell, contractAddress, loadStateInit, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { signVerify } from '@ton/crypto';
import { prisma } from '../prisma.js';
import { postLedger } from './ledger.js';
import { z } from 'zod';

export const walletProofInput = z.object({
  challengeId: z.string().min(1), address: z.string().max(128), network: z.enum(['-239','-3']),
  walletStateInit: z.string().min(1).max(20000),
  proof: z.object({ timestamp: z.coerce.number().int().positive(), domain: z.object({ lengthBytes: z.number().int().positive().max(255), value: z.string().max(255) }), payload: z.string().max(256), signature: z.string().max(128) }),
});
type Proof = z.infer<typeof walletProofInput>;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
export function proofDigest(address: Address, proof: Proof['proof']) {
  const wc = Buffer.alloc(4); wc.writeInt32BE(address.workChain);
  const dl = Buffer.alloc(4); dl.writeUInt32LE(proof.domain.lengthBytes);
  const time = Buffer.alloc(8); time.writeBigUInt64LE(BigInt(proof.timestamp));
  return sha(Buffer.concat([Buffer.from([255,255]), Buffer.from('ton-connect'), sha(Buffer.concat([Buffer.from('ton-proof-item-v2/'), wc, address.hash, dl, Buffer.from(proof.domain.value), time, Buffer.from(proof.payload)]))]));
}
export function verifyWalletProof(input: Proof, domain: string, network: string, now = Date.now()) {
  if (input.network !== network || input.proof.domain.value !== domain || Buffer.byteLength(domain) !== input.proof.domain.lengthBytes) throw new Error('Invalid proof domain or network');
  if (input.proof.timestamp * 1000 < now - 300000 || input.proof.timestamp * 1000 > now + 30000) throw new Error('Wallet proof has expired');
  const address = Address.parse(input.address);
  const init = loadStateInit(Cell.fromBase64(input.walletStateInit).beginParse());
  if (!init.code || !init.data || !contractAddress(address.workChain, init).equals(address)) throw new Error('Address does not match wallet contract');
  const dummy = Buffer.alloc(32);
  const v4 = WalletContractV4.create({ workchain: 0, publicKey: dummy });
  const v5 = WalletContractV5R1.create({ publicKey: dummy });
  const data = init.data.beginParse();
  if (init.code.hash().equals(v4.init.code.hash())) data.skip(64);
  else if (init.code.hash().equals(v5.init.code.hash())) { if (!data.loadBit()) throw new Error('Wallet signatures are disabled'); data.skip(64); }
  else throw new Error('A standard V4 or V5 wallet is required');
  const publicKey = data.loadBuffer(32), signature = Buffer.from(input.proof.signature, 'base64');
  if (signature.length !== 64 || !signVerify(proofDigest(address, input.proof), signature, publicKey)) throw new Error('Invalid wallet ownership proof');
  return address.toRawString();
}

export async function walletChallenge(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  const row = await prisma.walletChallenge.create({ data: { userId, address: wallet?.address ?? '', nonce: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now()+300000) } });
  return { id: row.id, payload: row.nonce, expiresAt: row.expiresAt, replacementCostGen: wallet ? 50 : 0 };
}

export async function saveProvenWallet(userId: string, input: Proof, domain: string, network: string) {
  const address = verifyWalletProof(input, domain, network);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const challenge = await tx.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } });
    if (challenge.userId !== userId || challenge.nonce !== input.proof.payload || challenge.expiresAt <= new Date() || challenge.consumedAt) throw new Error('Invalid proof request; please try again');
    const previous = await tx.wallet.findUnique({ where: { userId } });
    const parsed = Address.parse(address);
    const variants = [address, ...[true,false].flatMap(bounceable => [true,false].map(testOnly => parsed.toString({bounceable,testOnly})))];
    const other = await tx.wallet.findFirst({where:{userId:{not:userId},address:{in:variants}}});
    if(other) throw new Error('This wallet is already linked to another account');
    if ((previous?.address ?? '') !== challenge.address) throw new Error('Account wallet changed; create a new proof request');
    const changed = previous && !Address.parse(previous.address).equals(Address.parse(address));
    if (changed) {
      const source = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: `USER:${userId}:GEN:AVAILABLE` } });
      await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id=${source.id} FOR UPDATE`;
      const sum = await tx.ledgerEntry.aggregate({ where: { accountId: source.id }, _sum: { credit: true, debit: true } });
      if ((sum._sum.credit ?? 0n)-(sum._sum.debit ?? 0n)<50n) throw new Error('You need 50 GEN to change your wallet');
      const target = await tx.ledgerAccount.upsert({ where: { code: 'SYSTEM:GEN:WALLET_CHANGE' }, create: { code: 'SYSTEM:GEN:WALLET_CHANGE', currency:'GEN', type:'REVENUE' }, update:{} });
      await postLedger({ idempotencyKey:`wallet-change:${challenge.id}`,kind:'FEE',referenceType:'WalletChallenge',referenceId:challenge.id,postings:[{accountId:source.id,debit:50n},{accountId:target.id,credit:50n}] },tx);
      await tx.user.update({where:{id:userId},data:{genSpent:{increment:50n}}});
    }
    const wallet = await tx.wallet.upsert({where:{userId},create:{userId,address,verifiedAt:new Date()},update:{address,verifiedAt:new Date(),...(changed?{lastChangedAt:new Date()}:{})}});
    await tx.walletChallenge.update({where:{id:challenge.id},data:{consumedAt:new Date()}});
    await tx.auditEvent.create({data:{actorId:userId,action:'WALLET_OWNERSHIP_VERIFIED',entityType:'Wallet',entityId:wallet.id,after:{address,chargedGen:changed?50:0}}});
    return {address,verifiedAt:wallet.verifiedAt,chargedGen:changed?50:0};
  });
}
