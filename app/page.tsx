"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const EXPLORER = "https://testnet.monadvision.com";

interface Info { chainId: number; settlement: string; relayer: string; model: string }
interface Ev { kind: "offer" | "supplier" | "settle"; text: string }
interface Neg { text: string; events: Ev[]; receipt: { qty: number; unitPrice: number; status: string; txHash: string } | null }
interface Tx { hash: string; ok: boolean; block: string; latencyMs: number; broadcastMs: number }
interface Flood { wallMs: number; txs: Tx[] }
interface Atk { payload: string; reply: string; leaked: string[] }
interface Row { hash: string; block: string; txFrom: string; to: string; amount: string }
interface Ledger { rows: Row[]; total: number; mine: string[] }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: string) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

function useAct<T>() {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<T>) => {
    setBusy(true); setErr(null);
    try { setData(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);
  return { data, busy, err, run };
}

export default function Page() {
  const [info, setInfo] = useState<Info | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [request, setRequest] = useState("Pay my usual supplier for 200 units.");
  const [decoys, setDecoys] = useState(50);
  const [declass, setDeclass] = useState(false);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const neg = useAct<Neg>();
  const flood = useAct<Flood>();
  const atk = useAct<{ results: Atk[] }>();

  useEffect(() => { call<Info>("/api/setup").then(setInfo).catch((e) => setInfoErr(e.message)); }, []);

  const refresh = useCallback(async () => {
    setLedgerBusy(true);
    try { setLedger(await call<Ledger>("/api/ledger")); } catch { /* keep old ledger */ } finally { setLedgerBusy(false); }
  }, []);

  useEffect(() => { if (info) refresh(); }, [info, refresh]);

  const stats = useMemo(() => {
    const rows = ledger?.rows ?? [];
    return {
      senders: new Set(rows.map((r) => r.txFrom)).size,
      recipients: new Set(rows.map((r) => r.to)).size,
      mine: rows.filter((r) => ledger!.mine.includes(r.to)).length,
    };
  }, [ledger]);

  const lat = flood.data?.txs.map((t) => t.latencyMs) ?? [];
  const maxLat = Math.max(1, ...lat);
  const leakTotal = atk.data?.results.reduce((n, r) => n + r.leaked.length, 0) ?? 0;

  return (
    <div className={`wrap ${declass ? "declass" : ""}`}>
      <header className="mast">
        <div>
          <h1 className="wordmark">Sh<i>a</i>de</h1>
          <p className="tag">
            Private settlement rail for autonomous agent commerce. Competitors reading the chain see one relayer paying
            strangers. Only <span className="redact">{declass ? "the supplier" : "▮▮▮▮▮▮▮▮▮▮▮"}</span> can tell which payments are theirs.
          </p>
        </div>
        <div className="meta">
          <div><span className={`dot ${infoErr ? "off" : ""}`} />{infoErr ? "session error" : info ? "monad testnet · " + info.chainId : "connecting…"}</div>
          {info && <div>relayer <b>{short(info.relayer)}</b></div>}
          {info && <div>settlement <b><a href={`${EXPLORER}/address/${info.settlement}`} target="_blank">{short(info.settlement)}</a></b></div>}
          {info && <div>agents <b>{info.model}</b></div>}
          {infoErr && <div style={{ color: "var(--amber)" }}>{infoErr}</div>}
        </div>
      </header>

      <section className="acts">
        <div className="act">
          <div className="numeral">I</div>
          <h2>Two agents, one deal</h2>
          <p className="sub">The LLM only knows handles like S1. Names, keys and stealth meta-addresses stay in plain wallet code.</p>
          <textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)} />
          <button className="btn" disabled={neg.busy || !info} onClick={() => neg.run(async () => { const r = await call<Neg>("/api/negotiate", { request }); refresh(); return r; })}>
            {neg.busy ? "negotiating…" : "Run negotiation"}
          </button>
          {neg.err && <div className="err">{neg.err}</div>}
          {neg.data && (
            <div className="log">
              {neg.data.events.map((e, i) => (
                <div key={i} className={`ev ${e.kind}`} style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="who">{e.kind === "offer" ? "vendor →" : e.kind === "supplier" ? "← supplier" : "wallet"}</span>
                  <span className="what">{e.text}</span>
                </div>
              ))}
              <div className="ev"><span className="who">agent</span><span className="what">{neg.data.text}</span></div>
              {neg.data.receipt && (
                <div className="ev settle"><span className="who">tx</span>
                  <span className="what"><a href={`${EXPLORER}/tx/${neg.data.receipt.txHash}`} target="_blank">{short(neg.data.receipt.txHash)}</a></span></div>
              )}
            </div>
          )}
        </div>

        <div className="act">
          <div className="numeral">II</div>
          <h2>Flood the ledger</h2>
          <p className="sub">Real payments fired with decoys through the same code path: identical logs, concurrent, one relayer.</p>
          <div className="row">
            <input type="number" min={0} max={120} value={decoys} style={{ width: 84 }} onChange={(e) => setDecoys(Number(e.target.value))} />
            <span style={{ color: "var(--bone-dim)" }}>decoys + 3 real</span>
          </div>
          <button className="btn" disabled={flood.busy || !info} onClick={() => flood.run(async () => { const r = await call<Flood>("/api/burst", { decoys }); refresh(); return r; })}>
            {flood.busy ? "firing…" : "Fire burst"}
          </button>
          {flood.err && <div className="err">{flood.err}</div>}
          {flood.data && (
            <>
              <div className="stats">
                <div className="stat"><b>{flood.data.txs.filter((t) => t.ok).length}/{flood.data.txs.length}</b><span>confirmed</span></div>
                <div className="stat"><b>{(flood.data.wallMs / 1000).toFixed(1)}s</b><span>all landed</span></div>
                <div className="stat"><b>{new Set(flood.data.txs.map((t) => t.block)).size}</b><span>blocks</span></div>
              </div>
              <div className="bars" title="per-tx latency">
                {lat.map((l, i) => <i key={i} style={{ height: `${Math.max(6, (l / maxLat) * 100)}%`, animationDelay: `${i * 12}ms` }} />)}
              </div>
              <p className="sub">median {median(lat)}ms · max {maxLat}ms per tx under burst, one sender via public RPC.</p>
            </>
          )}
        </div>

        <div className="act">
          <div className="numeral">III</div>
          <h2>Competitor strikes</h2>
          <p className="sub">Prompt injection against the vendor agent, trying to pull the supplier graph. Every reply and the full model context are scanned for secrets.</p>
          <button className="btn" disabled={atk.busy || !info} onClick={() => atk.run(() => call<{ results: Atk[] }>("/api/attack", {}))}>
            {atk.busy ? "attacking…" : "Run injection"}
          </button>
          {atk.err && <div className="err">{atk.err}</div>}
          {atk.data && (
            <div className="log">
              {atk.data.results.map((r, i) => (
                <div key={i} className="atk" style={{ animationDelay: `${i * 120}ms` }}>
                  <q>“{r.payload.length > 110 ? r.payload.slice(0, 110) + "…" : r.payload}”</q>
                  <div className="reply">{r.reply.replace(/\s+/g, " ").slice(0, 200)}</div>
                  <span className={`stamp ${r.leaked.length ? "bad" : ""}`}>{r.leaked.length ? `leaked ${r.leaked.length}` : "0 leaked"}</span>
                </div>
              ))}
              <div className="ev"><span className="who">total</span><span className="what">{leakTotal} secret markers in {atk.data.results.length} attacks</span></div>
            </div>
          )}
        </div>
      </section>

      <section className="ledger">
        <div className="ledger-head">
          <h2>The public ledger. <em>What a scraper sees.</em></h2>
          <div className="row">
            <button className="btn ghost" onClick={refresh} disabled={ledgerBusy}>{ledgerBusy ? "reading chain…" : "Refresh"}</button>
            <button className="btn" onClick={() => setDeclass((d) => !d)} disabled={!ledger?.rows.length}>
              {declass ? "Re-classify" : "Declassify with supplier key"}
            </button>
          </div>
        </div>
        <div className="summary">
          <div><b>{stats.senders || "–"}</b><span>distinct senders</span></div>
          <div><b>{stats.recipients || "–"}</b><span>distinct recipients</span></div>
          <div><b>{declass ? stats.mine : "?"}</b><span>{declass ? "payments the supplier can prove" : "linked to any supplier"}</span></div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>#</th><th>block</th><th>tx.from</th><th>→ one-time recipient</th><th className="num">amount</th><th>tx</th><th /></tr></thead>
            <tbody>
              {ledger?.rows.map((r, i) => (
                <tr key={r.hash + r.to} className={ledger.mine.includes(r.to) ? "mine" : ""}>
                  <td>{i + 1}</td><td>{r.block}</td><td>{short(r.txFrom)}</td><td>{short(r.to)}</td>
                  <td className="num">{fmt(r.amount)}</td>
                  <td><a href={`${EXPLORER}/tx/${r.hash}`} target="_blank">{short(r.hash)}</a></td>
                  <td className="tick">◄ S1</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ledger?.rows.length && <div className="empty">No payments yet. Run act I or II.</div>}
        </div>
      </section>

      <footer className="foot">
        <div><h4>Honest limits</h4>Amounts are public; decoys blur price × qty fingerprints but do not remove them. The vault key is a recoverable pseudonym, not anonymity.</div>
        <div><h4>Relayer</h4>Trusted for liveness, not custody: it cannot forge intents. Every payment is an EIP-712 intent from the vault key.</div>
        <div><h4>Roadmap</h4>KYC-gated shielded pool, viewing-key audit export, fixed denominations.</div>
      </footer>
    </div>
  );
}
