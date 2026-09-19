export function SupportFaq(){return <section className="member-panel"><h3>Frequently asked questions</h3>{[
 ['How do I activate a package?','Open Recharge account, select a package and confirm its payment. A higher package requires a confirmed purchase of the previous package.'],
 ['How do I get extra time?','Buy a 24-hour task extension in Shop before the current deadline. Complete your tasks and claim your gift within the extended window.'],
 ['Why can’t I withdraw?','Connect and verify your registered mainnet wallet. Check your available balance, minimum amount and daily limit. New withdrawals may be paused by the administrator.'],
 ['Where is my lottery prize?','Open the room to review your award. Pay the winning bid within its deadline when required. Credited USDT can then be withdrawn through Wallet or Home.'],
 ['What should I send to support?','Describe the issue and include a transaction hash or ticket reference if relevant. Never share wallet recovery words, private keys or passwords.']
 ].map(([q,a])=><details key={q}><summary style={{padding:'12px 0',cursor:'pointer'}}>{q}</summary><p>{a}</p></details>)}</section>}
