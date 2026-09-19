import { describe,it,expect } from 'vitest';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { WalletContractV4,WalletContractV5R1,beginCell,storeStateInit } from '@ton/ton';
import { proofDigest,verifyWalletProof } from './wallet-proof.js';
describe('wallet ownership proof',()=>{
  for(const version of ['v4','v5']) it(`verifies ${version}, rejects wrong domain, network, payload and expiry`,()=>{
    const key=keyPairFromSeed(Buffer.alloc(32,7));
    const wallet=version==='v4'?WalletContractV4.create({workchain:0,publicKey:key.publicKey}):WalletContractV5R1.create({publicKey:key.publicKey});
    const proof={timestamp:Math.floor(Date.now()/1000),domain:{value:'smartgenyx.com',lengthBytes:14},payload:'single-use-test-nonce',signature:''};
    // The UTF8 byte length must match exactly.
    proof.domain.lengthBytes=Buffer.byteLength(proof.domain.value);
    proof.signature=sign(proofDigest(wallet.address,proof),key.secretKey).toString('base64');
    const input={challengeId:'test',address:wallet.address.toString(),network:'-239' as const,walletStateInit:beginCell().store(storeStateInit(wallet.init)).endCell().toBoc().toString('base64'),proof};
    expect(verifyWalletProof(input,'smartgenyx.com','-239')).toBe(wallet.address.toRawString());
    expect(()=>verifyWalletProof(input,'evil.com','-239')).toThrow();
    expect(()=>verifyWalletProof(input,'smartgenyx.com','-3')).toThrow();
    expect(()=>verifyWalletProof({...input,proof:{...proof,payload:'changed'}},'smartgenyx.com','-239')).toThrow();
    expect(()=>verifyWalletProof(input,'smartgenyx.com','-239',Date.now()+600000)).toThrow();
  });
});
