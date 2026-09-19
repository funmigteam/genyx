'use client';
import { useEffect, useState } from 'react';
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Node = { id: string; parentId: string | null; side: string | null; depth: number; code: string; name: string; active: boolean; direct: boolean };
type Lanes = { root: { id: string; code: string; name: string } | null; left: Node[]; right: Node[] };
function Lane({ title, nodes }: { title: string; nodes: Node[] }) {
  return <section className="binary-lane" aria-label={`${title} line`}><h4>{title} line</h4>{nodes.length ? nodes.map(node => <article className={`binary-node ${node.direct ? 'direct-referral' : ''}`} key={node.id} style={{ marginInlineStart: `${Math.min(node.depth - 1, 5) * 10}px` }}>
    <b>{node.code}</b><small>{node.name} · {node.active ? 'Active' : 'Pending'}</small>{node.direct && <em>Direct referral</em>}
  </article>) : <p>No placed member yet.</p>}</section>;
}
export function TeamTree({ request }: { request: Request }) {
  const [tree, setTree] = useState<Lanes | null>(null), [message, setMessage] = useState('');
  const load = () => void request<Lanes>('/v1/me/binary-tree').then(setTree).catch(error => setMessage(error instanceof Error ? error.message : 'Could not load placement graph.'));
  useEffect(load, []);
  return <section className="team-tree"><header><div><h3>Your placement graph</h3><p>Only your two binary lines are shown. Gold cards are your direct referrals; their placement can be deeper in either line.</p></div><button onClick={load}>Refresh</button></header>{message && <p role="status">{message}</p>}
    {tree?.root ? <><div className="binary-root"><b>{tree.root.code}</b><small>{tree.root.name}</small></div><div className="binary-lanes"><Lane title="Left" nodes={tree.left} /><Lane title="Right" nodes={tree.right} /></div></> : <p>Your placement graph appears after your first confirmed package.</p>}
  </section>;
}
