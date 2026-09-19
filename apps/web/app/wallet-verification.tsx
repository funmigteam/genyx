'use client';
import { useEffect, useState } from 'react';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
type Request = <T>(path:string,init?:RequestInit)=>Promise<T>;
export function WalletVerification({request}:{request:Request}) {
  const [ui]=useTonConnectUI(), wallet=useTonWallet();
  const [challenge,setChallenge]=useState<{id:string;payload:string;expiresAt:string;replacementCostGen:number}|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[consent,setConsent]=useState(false);
  useEffect(()=>()=>ui.setConnectRequestParameters(null),[ui]);
  const begin=async()=>{if(busy)return;setBusy(true);setConsent(false);try{
    const c=await request<NonNullable<typeof challenge>>('/v1/wallets/challenge',{method:'POST',body:'{}'});setChallenge(c);
    if(ui.connected)await ui.disconnect();
    ui.setConnectRequestParameters({state:'ready',value:{tonProof:c.payload}});await ui.openModal();
    setMessage('Approve the connection and ownership proof in your wallet, then review the details below.');
  }catch(e){setMessage(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}};
  const proof=wallet?.connectItems?.tonProof;
  return <section className="profile-settings" dir="ltr" lang="en"><h2>Register or change wallet</h2><p>First registration is free. Changing your registered address costs 50 GEN. Connecting a wallet alone does not change your registered address.</p><button disabled={busy} onClick={begin}>Choose wallet and request proof</button>
    {wallet && challenge && proof && 'proof' in proof && <><p style={{overflowWrap:'anywhere'}} dir="ltr">{wallet.account.address}</p><p>Change fee: {challenge.replacementCostGen} GEN (no fee for the same address).</p><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I confirm the address and fee</label><button disabled={busy||!consent} onClick={async()=>{setBusy(true);try{const r=await request<{chargedGen:number}>('/v1/wallets/verify',{method:'POST',body:JSON.stringify({challengeId:challenge.id,address:wallet.account.address,network:wallet.account.chain,walletStateInit:wallet.account.walletStateInit,proof:proof.proof})});setMessage(`Wallet verified; ${r.chargedGen} GEN charged.`);setChallenge(null);ui.setConnectRequestParameters(null);}catch(e){setMessage(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}}>Confirm and save</button></>}
    {wallet && challenge && (!proof || !('proof' in proof)) && <p>Ownership proof was not received. Reconnect using the request proof button.</p>}
    <p role="status">{message}</p></section>;
}
