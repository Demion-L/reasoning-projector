"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import demoNodesJson from "@/src/data/demo/nodes.json";
import { runCritic, buildGlobalSummary, type CriticReport, type GlobalCriticSummary } from "@/src/lib/critic";

// ─── DATA ─────────────────────────────────────────────────────────────────────

// Fallback used when nodes.json is absent or empty.
// Run `node scripts/fetch-memory.mjs` to regenerate src/data/nodes.json.
const MOCK_NODES: NodeData[] = [
  { id: "FIX-008",      tag: "fix",         x: 80,  y: 80,  w: 110, h: 44, who: "Mariana T.",                    when: "2024-03-11", what: "Клиент получил двойное списание при ретрае платежа.",                           signals: ["duplicate-charge","payment-retry","prod-incident"],          alts: [],                                                                          lost: "Сначала думали закрыть фиксом на уровне UI — отключить кнопку после клика. Отпало быстро." },
  { id: "INV-003",      tag: "invoice",     x: 300, y: 44,  w: 110, h: 44, who: "Sales ops",                     when: "2024-03-14", what: "Счёт ушёл клиенту дважды из-за двойного вызова /invoice/send.",                 signals: ["double-invoice","webhook-retry","client-complaint"],         alts: ["Добавить уникальный constraint в БД на invoice_id"],               lost: "Constraint вариант закрывал только инвойсы — не решал общую проблему." },
  { id: "BUG-014",      tag: "bug",         x: 80,  y: 172, w: 110, h: 44, who: "Pavel D.",                      when: "2024-03-18", what: "Race condition: два воркера параллельно обрабатывали одно событие.",             signals: ["race-condition","duplicate-processing","queue"],             alts: ["Distributed lock (Redis)","DB-level advisory lock"],               lost: "Redis lock отпал — добавлял зависимость и точку отказа. Advisory lock — слишком узко." },
  { id: "DECISION-001", tag: "decision",    x: 300, y: 146, w: 140, h: 48, who: "Arch review: Pavel, Mariana, CTO", when: "2024-03-20", what: "Ввести idempotency key на уровне API gateway.",                          signals: ["FIX-008","INV-003","BUG-014"],                               alts: ["UI-fix (отклонено)","DB constraint (слишком узко)","Redis lock (fragile)"], lost: "Обсуждали TTL для ключей — 24h vs 7 days. Зафиксировали 24h, но обоснование не попало в ADR." },
  { id: "ADR-002",      tag: "adr",         x: 510, y: 110, w: 110, h: 44, who: "Pavel D.",                      when: "2024-03-21", what: "Architecture Decision Record: Idempotency via API Gateway.",                    signals: ["DECISION-001","RFC-2119-MUST"],                              alts: [],                                                                          lost: "Раздел 'Rejected alternatives' в ADR остался пустым. Контекст отпавших вариантов утерян." },
];

const DEMO_NODES: NodeData[] =
  Array.isArray(demoNodesJson) && demoNodesJson.length > 0
    ? (demoNodesJson as unknown as NodeData[])
    : MOCK_NODES;

// Edges derived from signals so node order in JSON doesn't matter.
function buildEdges(nodes: NodeData[]): { from: number; to: number }[] {
  const idxById = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: { from: number; to: number }[] = [];
  nodes.forEach((node, toIdx) => {
    node.signals.forEach(sig => {
      const fromIdx = idxById.get(sig);
      if (fromIdx !== undefined) edges.push({ from: fromIdx, to: toIdx });
    });
  });
  return edges;
}

// ─── GRAPH / VALIDATION UTILITIES ────────────────────────────────────────────

function computeDepth(nodeCount: number, edges: { from: number; to: number }[]): number {
  if (nodeCount === 0) return 0;
  const dist = Array<number>(nodeCount).fill(-1);
  const inDeg = Array<number>(nodeCount).fill(0);
  edges.forEach(e => inDeg[e.to]++);
  const q: number[] = [];
  for (let i = 0; i < nodeCount; i++) if (inDeg[i] === 0) { dist[i] = 0; q.push(i); }
  let h = 0;
  while (h < q.length) {
    const u = q[h++];
    edges.filter(e => e.from === u).forEach(e => {
      if (dist[e.to] < dist[u] + 1) { dist[e.to] = dist[u] + 1; q.push(e.to); }
    });
  }
  return Math.max(0, ...dist.filter(d => d >= 0));
}

type ValidationResult =
  | { ok: false; error: string; nodesLoaded: boolean; edgesResolved: boolean; schemaValid: boolean }
  | { ok: true;  nodes: NodeData[]; nodesLoaded: true; edgesResolved: true; schemaValid: true };

function validateDataset(data: unknown): ValidationResult {
  if (!Array.isArray(data) || data.length === 0)
    return { ok: false, error: "Expected a non-empty array of nodes", nodesLoaded: false, edgesResolved: false, schemaValid: false };
  const required = ["id","tag","x","y","w","h","who","when","what","signals","alts","lost"] as const;
  for (const item of data) {
    if (typeof item !== "object" || item === null)
      return { ok: false, error: "Each element must be an object", nodesLoaded: true, edgesResolved: false, schemaValid: false };
    for (const f of required)
      if (!(f in (item as object)))
        return { ok: false, error: `Missing required field: "${f}"`, nodesLoaded: true, edgesResolved: false, schemaValid: false };
    const n = item as Record<string, unknown>;
    if (!Array.isArray(n.signals) || !Array.isArray(n.alts))
      return { ok: false, error: `"signals" and "alts" must be arrays`, nodesLoaded: true, edgesResolved: true, schemaValid: false };
  }
  return { ok: true, nodes: data as NodeData[], nodesLoaded: true, edgesResolved: true, schemaValid: true };
}

function computeSummary(nodes: NodeData[]) {
  const edges = buildEdges(nodes);
  return {
    artifacts: nodes.length,
    signals:   edges.length,
    decisions: nodes.filter(n => n.tag === "decision").length,
    debt:      nodes.filter(n => !!n.lost).length,
  };
}

function findPrimaryDecision(nodes: NodeData[]): number | null {
  const decisionIds = new Set(nodes.filter(n => n.tag === "decision").map(n => n.id));
  // which decisions are referenced as a signal by another decision (i.e. not terminal)
  const fedIntoDecision = new Set(
    nodes
      .filter(n => n.tag === "decision")
      .flatMap(n => n.signals.filter(s => decisionIds.has(s)))
  );
  const edges = buildEdges(nodes);
  const decisions = nodes
    .map((n, i) => ({
      i,
      inDeg: edges.filter(e => e.to === i).length,
      isTerminal: !fedIntoDecision.has(n.id),
    }))
    .filter((_, idx) => nodes[idx].tag === "decision");
  if (decisions.length === 0) return null;
  // terminal decision first (not consumed by another decision), then latest by index
  decisions.sort((a, b) => {
    if (a.isTerminal !== b.isTerminal) return a.isTerminal ? -1 : 1;
    return b.i - a.i;
  });
  return decisions[0].i;
}

// Direct neighbours of a node (signal-linked in either direction).
function getLinkedNodes(nodeIdx: number, nodes: NodeData[], edges: { from: number; to: number }[]): NodeData[] {
  const linked = new Set<number>();
  for (const e of edges) {
    if (e.from === nodeIdx) linked.add(e.to);
    if (e.to === nodeIdx)   linked.add(e.from);
  }
  return [...linked].map(i => nodes[i]);
}

function getConnectedIndices(nodeIdx: number, edges: { from: number; to: number }[]): Set<number> {
  const result = new Set<number>([nodeIdx]);
  const queue = [nodeIdx];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from === cur && !result.has(e.to))  { result.add(e.to);   queue.push(e.to); }
      if (e.to === cur   && !result.has(e.from)) { result.add(e.from); queue.push(e.from); }
    }
  }
  return result;
}

// ─── RECONSTRUCTION ENGINE ────────────────────────────────────────────────────

function buildReconstruction(node: NodeData, allNodes: NodeData[]): string {
  const nodeById = new Map(allNodes.map(n => [n.id, n]));
  const evidenceNodes = node.signals
    .map(sig => nodeById.get(sig))
    .filter((n): n is NodeData => n !== undefined);

  const tagIntro: Record<string, string> = {
    decision: "was introduced because multiple signals converged on a systemic failure",
    fix:      "was applied in response to a production incident",
    bug:      "was identified as the root cause of service degradation",
    invoice:  "was reported after a client-facing data integrity failure",
    adr:      "was created to formalize an architecture decision",
  };

  const intro = tagIntro[node.tag] ?? "was recorded in the system";
  const lines: string[] = [];

  lines.push(`${node.id} ${intro}.`);
  lines.push(`Recorded: ${node.when}  ·  Author: ${node.who}`);
  lines.push("");
  lines.push(node.what);
  lines.push("");

  if (evidenceNodes.length > 0) {
    lines.push("Evidence detected:");
    evidenceNodes.forEach(n => lines.push(`  • ${n.id}  ${n.what}`));
    lines.push("");
  }

  if (node.alts.length > 0) {
    lines.push("Alternatives considered:");
    node.alts.forEach(a => lines.push(`  • ${a}`));
    lines.push("  These alternatives were rejected because they addressed only");
    lines.push("  partial failure modes.");
    lines.push("");
  }

  if (node.lost) {
    lines.push("Reasoning Debt detected:");
    lines.push("");
    lines.push(`  ${node.lost}`);
    lines.push("");
    lines.push("  This rationale is no longer recoverable from source systems.");
    lines.push("");
  }

  const score =
    (evidenceNodes.length > 0 ? 1 : 0) +
    (node.alts.length > 0     ? 1 : 0) +
    (!node.lost                ? 1 : 0);
  const confidence = score >= 3 ? "HIGH" : score >= 1 ? "MEDIUM" : "LOW";
  lines.push(`Confidence: ${confidence}`);

  return lines.join("\n");
}

const REPLAY_STEPS = [
  { text: "WHO MADE THE CALL?",                  sub: "reconstructing authorship..."   },
  { text: "Arch review",                          sub: "Pavel D. · Mariana T. · CTO"   },
  { text: "WHAT WERE THE SIGNALS?",              sub: "scanning artifact links..."     },
  { text: "3 independent incidents",             sub: "converging on one root cause"   },
  { text: "WHAT ALTERNATIVES FELL?",             sub: "recovering rejected paths..."   },
  { text: "UI-fix · DB constraint · Redis lock", sub: "all rejected — reasons below"  },
  { text: "WHAT WAS LOST?",                      sub: "detecting missing context..."   },
  { text: "TTL rationale not in ADR",            sub: "context gap identified"         },
  { text: "Memory reconstructed.",               sub: "click any node to inspect"      },
];

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const C = {
  bg:         "#020408",
  bgPanel:    "#040c14",
  bgPanelHi:  "#061525",
  border:     "rgba(15,55,90,0.7)",
  borderHi:   "rgba(35,90,140,0.55)",
  cyan:       "#4fc3f7",
  cyanDim:    "#1a5c7c",
  cyanGlow:   "rgba(79,195,247,0.14)",
  cyanGlow2:  "rgba(79,195,247,0.06)",
  text:       "#cfe3ec",
  textDim:    "#80a6ba",
  textBright: "#f2fafe",
  amber:      "#ffb74d",
  amberDim:   "rgba(255,183,77,0.1)",
  green:      "#66bb6a",
  red:        "#ef5350",
  font:       "'SF Mono','Fira Code','Consolas',monospace",
};

// ─── STAR FIELD ───────────────────────────────────────────────────────────────

function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const stars = Array.from({ length: 260 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.1 + 0.1,
      op: 0.12 + Math.random() * 0.5,
      spd: 0.3 + Math.random() * 1.6,
      off: Math.random() * Math.PI * 2,
    }));
    let t = 0, rafId = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(s => {
        const tw = 0.55 + 0.45 * Math.sin(t * s.spd + s.off);
        ctx.beginPath();
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(185,215,255,${s.op * tw})`;
        ctx.fill();
      });
      t += 0.01;
      rafId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }} />;
}

// ─── GRID OVERLAY ─────────────────────────────────────────────────────────────

function GridOverlay() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1,
      backgroundImage: [
        "linear-gradient(rgba(15,55,90,0.14) 1px, transparent 1px)",
        "linear-gradient(90deg, rgba(15,55,90,0.14) 1px, transparent 1px)",
      ].join(","),
      backgroundSize: "64px 64px",
    }} />
  );
}

// ─── NEBULA GLOW (backdrop for glass panels) ──────────────────────────────────

function NebulaGlow() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
      background: [
        "radial-gradient(720px 560px at 8% 4%, rgba(64,168,224,0.42), transparent 66%)",
        "radial-gradient(820px 660px at 92% 96%, rgba(34,158,172,0.34), transparent 68%)",
        "radial-gradient(1000px 800px at 50% 46%, rgba(40,96,150,0.26), transparent 72%)",
      ].join(","),
    }} />
  );
}

// ─── MET CLOCK ────────────────────────────────────────────────────────────────

function useHelsinkiTime() {
  const fmt = () =>
    new Date().toLocaleTimeString("fi-FI", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  // Start empty so server and first client render match (avoids hydration mismatch),
  // then fill in on the client after mount.
  const [time, setTime] = useState("--:--:--");
  useEffect(() => { setTime(fmt()); const id = setInterval(() => setTime(fmt()), 1000); return () => clearInterval(id); }, []);
  return time;
}

// ─── TOP HUD ──────────────────────────────────────────────────────────────────

function TopHUD({ phase, debtCount }: { phase: string; debtCount: number }) {
  const time = useHelsinkiTime();
  const [blink, setBlink] = useState(true);
  useEffect(() => { const id = setInterval(() => setBlink(b => !b), 900); return () => clearInterval(id); }, []);

  return (
    <div data-testid="rp-header" style={{
      position: "relative", zIndex: 20, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16,
      padding: "0 24px", height: 50,
      margin: "10px 10px 0 10px",
      minWidth: 0, overflow: "hidden",
      borderRadius: 6,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "linear-gradient(135deg, rgba(255,255,255,0.11), rgba(120,170,210,0.04) 55%, rgba(255,255,255,0.02))",
      backdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      WebkitBackdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      boxShadow: "0 10px 36px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 0 0 1px rgba(255,255,255,0.04)",
    }}>
      {/* Logo + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28,
          border: `1px solid ${C.cyanDim}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
          boxShadow: `inset 0 0 10px ${C.cyanGlow2}, 0 0 12px ${C.cyanGlow2}`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.cyan, letterSpacing: 1 }}>RP</span>
          {/* corner ticks */}
          {[{t:-2,l:-2},{t:-2,r:-2},{b:-2,l:-2},{b:-2,r:-2}].map((p,i) => (
            <div key={i} style={{
              position:"absolute", width:5, height:5,
              borderTop:    i<2  ? `1px solid ${C.cyan}` : undefined,
              borderBottom: i>=2 ? `1px solid ${C.cyan}` : undefined,
              borderLeft:   i%2===0 ? `1px solid ${C.cyan}` : undefined,
              borderRight:  i%2===1 ? `1px solid ${C.cyan}` : undefined,
              top: "t" in p ? p.t : undefined,
              bottom: "b" in p ? (p as {b:number}).b : undefined,
              left: "l" in p ? p.l : undefined,
              right: "r" in p ? (p as {r:number}).r : undefined,
            }} />
          ))}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textBright, letterSpacing: "0.22em", textShadow: `0 0 10px ${C.cyanGlow}` }}>
            REASONING PROJECTOR
          </div>
          <div style={{ fontSize: 9, color: C.text, letterSpacing: "0.22em", marginTop: 1 }}>
            DECISION INTELLIGENCE SYSTEM · v0.1.0
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "flex", gap: 30, alignItems: "center", flexShrink: 1 }}>
        {([
          { label: "HEL",   value: time,               color: C.cyan },
          { label: "PHASE", value: phase.toUpperCase(), color: C.cyan },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.28em", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 12, color, letterSpacing: "0.06em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Status chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: blink ? C.green : "transparent", border: `1px solid ${C.green}`, transition: "background 0.4s" }} />
          <span style={{ fontSize: 10, color: C.green, letterSpacing: "0.18em" }}>NOMINAL</span>
        </div>
        <div style={{ width: "0.5px", height: 14, background: C.border }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.amber }} />
          <span style={{ fontSize: 10, color: C.amber, letterSpacing: "0.14em" }}>{debtCount} DEBT DETECTED</span>
        </div>
      </div>
    </div>
  );
}

// ─── LEFT TELEMETRY PANEL ─────────────────────────────────────────────────────

function LeftTelemetry({ nodes, edgeCount, depth, debtCount }: {
  nodes: NodeData[]; edgeCount: number; depth: number; debtCount: number;
}) {
  const [cpu, setCpu] = useState(12.4);
  const [mem, setMem] = useState(34.1);
  useEffect(() => {
    const id = setInterval(() => {
      setCpu(v => +Math.max(5,  Math.min(45, v + (Math.random()-.5)*3)).toFixed(1));
      setMem(v => +Math.max(20, Math.min(65, v + (Math.random()-.5)*1.5)).toFixed(1));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const [tokIn,  setTokIn]  = useState(0);
  const [tokOut, setTokOut] = useState(0);
  const [calls,  setCalls]  = useState(0);
  const [latMs,  setLatMs]  = useState(0);
  const [ctxPct, setCtxPct] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTokIn(v  => v  + Math.floor(Math.random() * 0));
      setTokOut(v => v  + Math.floor(Math.random() * 0));
      setLatMs(v  => +Math.max(180, Math.min(640, v + (Math.random()-.5)*40)).toFixed(0));
      setCtxPct(v => +Math.max(2,   Math.min(18,  v + (Math.random()-.5)*1.2)).toFixed(1));
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div data-testid="rp-left-panel" style={{
      width: 180, flexShrink: 0,
      margin: "10px",
      borderRadius: 6,
      border: "1px solid rgba(255,255,255,0.18)",
      position: "relative",
      overflow: "hidden",
      background: "linear-gradient(135deg, rgba(255,255,255,0.11), rgba(120,170,210,0.04) 55%, rgba(255,255,255,0.02))",
      backdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      WebkitBackdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      boxShadow: "0 10px 36px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 0 0 1px rgba(255,255,255,0.04)",
    }}>
      <div style={{
        height: "100%", overflowY: "auto", overflowX: "hidden",
        padding: "14px 13px",
        display: "flex", flexDirection: "column", gap: 11,
      }}>
      <Sect>TRACE TELEMETRY</Sect>
      <TR label="NODES" val={nodes.length > 0 ? String(nodes.length) : "—"} color={C.cyan} />
      <TR label="EDGES" val={nodes.length > 0 ? String(edgeCount)     : "—"} color={C.cyan} />
      <TR label="DEPTH" val={nodes.length > 0 ? `${depth} hops`       : "—"} color={C.text} />
      <TR label="DEBT"  val={nodes.length > 0 ? `${debtCount} nodes`  : "—"} color={C.amber} glow={debtCount > 0} />
      <HR />
      <Sect>RUNTIME</Sect>
      <TR label="CPU" val={`${cpu}%`} color={C.textDim} />
      <TR label="MEM" val={`${mem}%`} color={C.textDim} />
      <HR />
      <Sect>AI MODEL</Sect>
      {/* Model info card — stacked so text values never overflow the panel width */}
      <div style={{
        border: `0.5px solid rgba(79,195,247,0.22)`,
        background: "rgba(4,14,28,0.55)",
        padding: "8px 10px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>PROVIDER</span>
          <span style={{ fontSize: 11, color: C.cyan, letterSpacing: "0.04em" }}>OpenBMB</span>
        </div>
        <div style={{ borderTop: `0.5px solid rgba(15,55,90,0.4)`, paddingTop: 5 }}>
          <div style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em", marginBottom: 2 }}>ENGINE</div>
          <div style={{ fontSize: 12, color: C.textBright, letterSpacing: "0.04em" }}>MiniCPM4-8B</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `0.5px solid rgba(15,55,90,0.4)`, paddingTop: 5 }}>
          <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>AgentCPM</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.green, boxShadow: `0 0 4px ${C.green}` }} />
            <span style={{ fontSize: 9, color: C.green, letterSpacing: "0.1em" }}>READY</span>
          </div>
        </div>
      </div>
      <HR />
      <Sect>SESSION</Sect>
      <TR label="TOK IN"  val={tokIn  > 0 ? String(tokIn)  : "—"} color={C.textDim} />
      <TR label="TOK OUT" val={tokOut > 0 ? String(tokOut) : "—"} color={C.textDim} />
      <TR label="CALLS"   val={calls  > 0 ? String(calls)  : "—"} color={C.textDim} />
      <TR label="LATENCY" val={latMs  > 0 ? `${latMs} ms`  : "—"} color={C.textDim} />
      <TR label="CTX"     val={`${ctxPct}%`}                       color={C.textDim} />
      <HR />
      <Sect>SCOPE</Sect>
      {[
        "Missing Context",
        "Weak Assumptions",
        "Debt Risk Level",
        "Suggest Artifacts",
      ].map((role, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <span style={{ color: C.cyanDim, fontSize: 10, lineHeight: 1.55, flexShrink: 0 }}>›</span>
          <span style={{ fontSize: 10, color: C.text, lineHeight: 1.55, letterSpacing: "0.02em" }}>{role}</span>
        </div>
      ))}
      </div>
    </div>
  );
}

// ─── RIGHT SYSTEM PANEL ───────────────────────────────────────────────────────

function RightSystem({ nodes, selectedNode, onSelect }: {
  nodes: NodeData[];
  selectedNode: number | null;
  onSelect: (i: number) => void;
}) {
  const [tick,    setTick]    = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 550); return () => clearInterval(id); }, []);
  const WL = 16;
  // Round to whole pixels so SSR and client serialize identically (avoids hydration mismatch).
  const wave = Array.from({ length: WL }, (_, i) => Math.round(Math.abs(Math.sin((i - tick) * 0.55)) * 24 + 3));

  return (
    <div data-testid="rp-right-panel" style={{
      width: 180, flexShrink: 0,
      margin: "10px",
      borderRadius: 6,
      border: "1px solid rgba(255,255,255,0.18)",
      position: "relative",
      overflow: "hidden",
      background: "linear-gradient(135deg, rgba(255,255,255,0.11), rgba(120,170,210,0.04) 55%, rgba(255,255,255,0.02))",
      backdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      WebkitBackdropFilter: "blur(34px) saturate(185%) brightness(1.08)",
      boxShadow: "0 10px 36px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 0 0 1px rgba(255,255,255,0.04)",
    }}>
      <div style={{
        height: "100%", overflowY: "auto", overflowX: "hidden",
        padding: "14px 13px",
        display: "flex", flexDirection: "column", gap: 11,
      }}>
      <Sect>SYSTEMS</Sect>
      <SR label="GRAPH ENGINE"   ok />
      <SR label="REPLAY ENGINE"  ok />
      <SR label="DEBT SCANNER"   warn />
      <SR label="ADR PARSER"     ok />
      <SR label="LINK RESOLVER"  ok />
      <HR />
      <Sect>SIGNAL</Sect>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 30, marginTop: 2 }}>
        {wave.map((h, i) => (
          <div key={i} style={{
            flex: 1, height: h, borderRadius: 1,
            background: i === tick % WL ? C.cyan : C.cyanDim,
            transition: "height 0.22s ease",
            boxShadow: i === tick % WL ? `0 0 6px ${C.cyan}` : undefined,
          }} />
        ))}
      </div>
      <HR />
      <Sect>ARTIFACTS</Sect>
      {nodes.map((n, i) => {
        const active = selectedNode === i;
        const hover  = hovered === i;
        return (
          <div
            key={n.id}
            onClick={() => onSelect(i)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontSize: 11, letterSpacing: "0.06em", lineHeight: 1.6,
              padding: "3px 4px 3px 7px",
              cursor: "pointer",
              borderLeft: `1.5px solid ${active ? C.cyan : hover ? C.cyanDim : n.tag === "decision" ? C.cyanDim : C.border}`,
              color: active ? C.textBright : hover ? C.text : n.tag === "decision" ? C.cyan : C.text,
              background: active ? "rgba(79,195,247,0.08)" : hover ? "rgba(79,195,247,0.04)" : "transparent",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              boxShadow: active ? `inset 0 0 12px rgba(79,195,247,0.06)` : undefined,
            }}
          >
            {n.id}
            <span style={{ marginLeft: 5, fontSize: 10, color: active ? C.cyanDim : C.textDim, letterSpacing: "0.14em" }}>{n.tag}</span>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ─── PANEL HELPERS ────────────────────────────────────────────────────────────

function Sect({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.14em", textTransform: "uppercase" as const }}>{children}</div>;
}
function HR() { return <div style={{ height: "0.5px", background: C.border }} />; }
function TR({ label, val, color, glow }: { label: string; val: string; color: string; glow?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 10, color: C.text, letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 12, color, fontVariantNumeric: "tabular-nums", textShadow: glow ? `0 0 8px ${color}` : undefined }}>{val}</span>
    </div>
  );
}
function SR({ label, ok, warn }: { label: string; ok?: boolean; warn?: boolean }) {
  const color = warn ? C.amber : ok ? C.green : C.red;
  const status = warn ? "WARN" : ok ? "OK" : "FAIL";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: C.text, letterSpacing: "0.05em" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 10, color, letterSpacing: "0.15em" }}>{status}</span>
      </div>
    </div>
  );
}

// ─── CORNER BRACKETS ─────────────────────────────────────────────────────────

function Brackets({ size = 16, color = C.cyan, inset = 0, thickness = 1.5, pulse = false }: {
  size?: number; color?: string; inset?: number; thickness?: number; pulse?: boolean;
}) {
  const b = `${thickness}px solid ${color}`;
  return (
    <>
      {[
        { top: inset,    left: inset,    borderTop: b, borderLeft: b },
        { top: inset,    right: inset,   borderTop: b, borderRight: b },
        { bottom: inset, left: inset,    borderBottom: b, borderLeft: b },
        { bottom: inset, right: inset,   borderBottom: b, borderRight: b },
      ].map((st, i) => (
        <div key={i} className={pulse ? "rp-corner" : undefined}
          style={{ position: "absolute", width: size, height: size, color, pointerEvents: "none", zIndex: 5, ...st }} />
      ))}
    </>
  );
}

// ─── BOTTOM STATUS BAR ────────────────────────────────────────────────────────

function BottomBar() {
  const [seq, setSeq] = useState(0);
  useEffect(() => { const id = setInterval(() => setSeq(s => s + 1), 80); return () => clearInterval(id); }, []);
  return (
    <div data-testid="rp-footer" style={{
      position: "relative", zIndex: 20, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12,
      padding: "0 20px", height: 26,
      minWidth: 0, overflow: "hidden",
      borderTop: `0.5px solid ${C.border}`,
      background: "rgba(2,4,8,0.96)",
    }}>
      <div style={{ display: "flex", gap: 20, flex: 1, minWidth: 0, overflow: "hidden" }}>
        {[
          { t: "GRAPH ENGINE · READY" },
          { t: "REPLAY ENGINE · READY" },
          { t: "DEBT SCANNER · 1 FLAGGED", warn: true },
          { t: "ADR PARSER · NOMINAL" },
        ].map(({ t, warn }, i) => (
          <span key={i} style={{ fontSize: 9, letterSpacing: "0.2em", color: warn ? C.amber : C.textDim, flexShrink: 1, whiteSpace: "nowrap" }}>
            {t}
          </span>
        ))}
      </div>
      <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        SEQ {String(seq).padStart(7, "0")}
      </span>
    </div>
  );
}

// ─── CENTER STYLES ────────────────────────────────────────────────────────────

const s = {
  hugeText: {
    fontSize: 28, fontWeight: 500, textAlign: "center" as const,
    lineHeight: 1.3, color: C.textBright,
    textShadow: `0 0 48px rgba(79,195,247,0.18)`,
  },
  label: { fontSize: 13, color: C.textDim, letterSpacing: "0.22em", marginTop: 10, textAlign: "center" as const },
  ghostBtn: {
    marginTop: 28, padding: "9px 32px", fontSize: 13, letterSpacing: "0.25em",
    background: "transparent",
    border: `0.5px solid ${C.cyanDim}`,
    color: C.cyan, cursor: "pointer",
    fontFamily: C.font,
    borderRadius: 0,
    transition: "all 0.2s",
    boxShadow: `0 0 24px ${C.cyanGlow}, inset 0 0 16px ${C.cyanGlow2}`,
    position: "relative" as const,
  },
  midText: {
    fontSize: 20, fontWeight: 500, textAlign: "center" as const,
    letterSpacing: "0.04em", color: C.textBright, minHeight: 56,
  },
  progressBar: { width: 240, height: "0.5px", background: C.border, marginTop: 32, position: "relative" as const },
  progressFill: { height: "0.5px", background: C.cyan, transition: "width 0.4s", boxShadow: `0 0 8px ${C.cyan}` },
  panel: {
    width: "100%",
    border: `0.5px solid ${C.border}`,
    borderRadius: 3,
    background: C.bgPanel,
    marginTop: 14,
    overflow: "hidden",
  },
  panelHeader: {
    padding: "11px 16px",
    borderBottom: `0.5px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  panelId:   { fontSize: 16, fontWeight: 500, color: C.textBright, letterSpacing: "0.08em" },
  panelTag:  { fontSize: 11,  letterSpacing: "0.25em", color: C.textDim, padding: "3px 8px", border: `0.5px solid ${C.border}` },
  panelBody: { padding: "12px 16px" },
  row:  { display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" as const },
  key:  { fontSize: 13, color: C.textDim, letterSpacing: "0.08em", width: 90, flexShrink: 0, paddingTop: 2 },
  val:  { fontSize: 15, color: C.text, lineHeight: 1.65 },
  signal: {
    display: "inline-block", fontSize: 11, letterSpacing: "0.1em",
    padding: "2px 8px", margin: "2px 4px 2px 0",
    border: `0.5px solid ${C.border}`, color: C.textDim,
  },
  alt: {
    display: "block", fontSize: 14, color: C.textDim,
    margin: "3px 0", paddingLeft: 8, borderLeft: `2px solid ${C.border}`,
  },
  lost: { fontSize: 14, color: C.red, letterSpacing: "0.02em" },
  panelFooter: {
    padding: "10px 16px",
    borderTop: `0.5px solid ${C.border}`,
    display: "flex", gap: 12, alignItems: "center",
  },
  footerLabel: { fontSize: 13, color: C.textDim, letterSpacing: "0.08em" },
  smBtn: {
    padding: "5px 14px", fontSize: 12, letterSpacing: "0.18em",
    background: "transparent", border: `0.5px solid ${C.border}`,
    color: C.textDim, cursor: "pointer", fontFamily: C.font,
    borderRadius: 0, transition: "color 0.2s, border-color 0.2s",
  },
};

// ─── INGEST SCREEN ────────────────────────────────────────────────────────────

type InputMode = "upload" | "paste";

function IngestScreen({ onLoad }: { onLoad: (nodes: NodeData[]) => void }) {
  const [inputMode, setInputMode]   = useState<InputMode>("upload");
  const [dragging,  setDragging]    = useState(false);
  const [pasteText, setPasteText]   = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [demoHover, setDemoHover]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const process = (raw: unknown) => {
    const result = validateDataset(raw);
    setValidation(result);
    return result;
  };

  const loadDemo = () => {
    const result = process(DEMO_NODES);
    if (result.ok) onLoad(result.nodes);
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        const result = process(parsed);
        if (result.ok) onLoad(result.nodes);
      } catch {
        setValidation({ ok: false, error: "Invalid JSON — could not parse file", nodesLoaded: false, edgesResolved: false, schemaValid: false });
      }
    };
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  const onPasteParse = () => {
    try {
      const parsed = JSON.parse(pasteText);
      const result = process(parsed);
      if (result.ok) onLoad(result.nodes);
    } catch {
      setValidation({ ok: false, error: "Invalid JSON — check your input", nodesLoaded: false, edgesResolved: false, schemaValid: false });
    }
  };

  const summary = validation?.ok ? computeSummary(validation.nodes) : null;

  const ValidationRow = ({ label, ok }: { label: string; ok: boolean }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ fontSize: 13, color: ok ? C.green : C.red, fontFamily: C.font }}>{ok ? "✓" : "✗"}</span>
      <span style={{ fontSize: 12, color: ok ? C.green : C.red, letterSpacing: "0.08em" }}>{label}</span>
    </div>
  );

  const tabBtn = (mode: InputMode, label: string) => (
    <button
      onClick={() => { setInputMode(mode); setValidation(null); }}
      style={{
        flex: 1, padding: "8px 0", fontSize: 11, letterSpacing: "0.22em",
        background: inputMode === mode ? "rgba(79,195,247,0.08)" : "transparent",
        border: "none",
        borderBottom: `1.5px solid ${inputMode === mode ? C.cyan : C.border}`,
        color: inputMode === mode ? C.cyan : C.textDim,
        cursor: "pointer", fontFamily: C.font,
        transition: "all 0.2s",
      }}
    >{label}</button>
  );

  return (
    <div style={{
      width: "100%", maxWidth: 560,
      display: "flex", flexDirection: "column", gap: 20,
    }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 13, color: C.textDim, letterSpacing: "0.36em", marginBottom: 8 }}>
          MEMORY ARCHIVE LOADER
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: C.textBright, letterSpacing: "0.06em" }}>
          Select artifact source
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 6, letterSpacing: "0.04em" }}>
          Load a reasoning dataset to begin reconstruction
        </div>
      </div>

      {/* Demo button */}
      <button
        onClick={loadDemo}
        onMouseEnter={() => setDemoHover(true)}
        onMouseLeave={() => setDemoHover(false)}
        style={{
          width: "100%", padding: "18px 24px",
          background: demoHover ? "rgba(79,195,247,0.07)" : "rgba(79,195,247,0.03)",
          border: `0.5px solid ${demoHover ? C.cyan : C.cyanDim}`,
          color: C.textBright, cursor: "pointer", fontFamily: C.font,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderRadius: 0, transition: "all 0.25s",
          boxShadow: demoHover ? `0 0 28px rgba(79,195,247,0.12), inset 0 0 20px rgba(79,195,247,0.04)` : "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.18em", color: C.cyan }}>
            ▶▶  LOAD DEMO DATASET
          </span>
          <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.12em" }}>
            src/data/demo/nodes.json  ·  pre-validated  ·  ready to reconstruct
          </span>
        </div>
        <span style={{ fontSize: 18, color: C.cyanDim, marginLeft: 16 }}>↗</span>
      </button>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: "0.5px", background: C.border }} />
        <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.28em" }}>OR</span>
        <div style={{ flex: 1, height: "0.5px", background: C.border }} />
      </div>

      {/* Tabs + input area */}
      <div style={{ border: `0.5px solid ${C.border}`, background: "rgba(4,12,20,0.7)" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: `0.5px solid ${C.border}` }}>
          {tabBtn("upload", "UPLOAD FILE")}
          {tabBtn("paste",  "PASTE JSON")}
        </div>

        {/* Upload mode */}
        {inputMode === "upload" && (
          <>
            <input
              ref={fileRef} type="file" accept=".json"
              onChange={onFileInput}
              style={{ display: "none" }}
            />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{
                padding: "36px 24px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                cursor: "pointer",
                background: dragging ? "rgba(79,195,247,0.06)" : "transparent",
                border: `0.5px dashed ${dragging ? C.cyan : C.border}`,
                margin: 16,
                transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 22, color: dragging ? C.cyan : C.textDim, transition: "color 0.2s" }}>⬆</div>
              <div style={{ fontSize: 13, color: dragging ? C.cyan : C.text, letterSpacing: "0.1em" }}>
                {dragging ? "DROP TO LOAD" : "DRAG & DROP  nodes.json"}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.12em" }}>
                or click to browse  ·  .json only
              </div>
            </div>
          </>
        )}

        {/* Paste mode */}
        {inputMode === "paste" && (
          <div style={{ padding: "16px" }}>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={'[\n  { "id": "NODE-001", "tag": "decision", ... }\n]'}
              style={{
                width: "100%", height: 140, boxSizing: "border-box",
                background: "rgba(1,5,11,0.9)", color: C.text,
                border: `0.5px solid ${C.border}`, borderRadius: 0,
                fontFamily: C.font, fontSize: 12, lineHeight: 1.6,
                padding: "10px 12px", resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                onClick={onPasteParse}
                disabled={!pasteText.trim()}
                style={{
                  padding: "6px 18px", fontSize: 11, letterSpacing: "0.22em",
                  background: "transparent",
                  border: `0.5px solid ${pasteText.trim() ? C.cyanDim : C.border}`,
                  color: pasteText.trim() ? C.cyan : C.textDim,
                  cursor: pasteText.trim() ? "pointer" : "default",
                  fontFamily: C.font, borderRadius: 0, transition: "all 0.2s",
                }}
              >
                PARSE ↗
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Validation results */}
      {validation && (
        <div style={{
          border: `0.5px solid ${validation.ok ? C.cyanDim : C.red}`,
          padding: "14px 16px",
          background: validation.ok ? "rgba(79,195,247,0.03)" : "rgba(239,83,80,0.05)",
        }}>
          {!validation.ok && (
            <div style={{ fontSize: 12, color: C.red, letterSpacing: "0.08em", marginBottom: 10 }}>
              ✗  {validation.error}
            </div>
          )}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" as const }}>
            <ValidationRow label="nodes loaded"   ok={validation.nodesLoaded} />
            <ValidationRow label="edges resolved" ok={validation.edgesResolved} />
            <ValidationRow label="schema valid"   ok={validation.schemaValid} />
          </div>

          {/* Summary */}
          {summary && (
            <>
              <div style={{ height: "0.5px", background: C.border, margin: "12px 0" }} />
              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" as const }}>
                {([
                  { label: "Artifacts",  val: summary.artifacts },
                  { label: "Signals",    val: summary.signals   },
                  { label: "Decisions",  val: summary.decisions },
                  { label: "Debt",       val: summary.debt      },
                ] as const).map(({ label, val }, i) => (
                  <div key={label} style={{
                    flex: "1 0 25%", textAlign: "center" as const,
                    padding: "10px 0",
                    borderRight: i < 3 ? `0.5px solid ${C.border}` : "none",
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 500, color: C.cyan, fontVariantNumeric: "tabular-nums" }}>
                      {val}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.18em", marginTop: 3 }}>
                      {label.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

type Phase = "ingest" | "intro" | "replay" | "graph";

export default function MemoryReplay() {
  const [activeNodes, setActiveNodes]   = useState<NodeData[]>([]);
  const [phase, setPhase]               = useState<Phase>("ingest");
  const [replayIdx, setReplayIdx]       = useState(0);
  const [replayVisible, setReplayVisible] = useState(true);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [panelOpen, setPanelOpen]       = useState(false);

  const activeEdges    = buildEdges(activeNodes);
  const depth          = computeDepth(activeNodes.length, activeEdges);
  const debtCount      = activeNodes.filter(n => !!n.lost).length;
  const defaultNodeIdx = Math.max(0, activeNodes.findIndex(n => n.tag === "decision"));

  useEffect(() => {
    if (phase !== "replay") return;
    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < REPLAY_STEPS.length; i++) {
        if (cancelled) return;
        setReplayVisible(false);
        await delay(250);
        if (cancelled) return;
        setReplayIdx(i);
        setReplayVisible(true);
        await delay(i % 2 === 1 ? 950 : 520);
      }
      if (!cancelled) { await delay(400); setPhase("graph"); }
    };
    run();
    return () => { cancelled = true; };
  }, [phase]);

  const step     = REPLAY_STEPS[replayIdx];
  const progress = ((replayIdx + 1) / REPLAY_STEPS.length) * 100;

  return (
    <div data-testid="rp-root" style={{
      fontFamily: C.font,
      background: C.bg,
      color: C.text,
      height: "100vh",
      maxHeight: "100vh",
      width: "100vw",
      maxWidth: "100vw",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      <NebulaGlow />
      <StarField />
      <GridOverlay />
      <TopHUD phase={phase} debtCount={debtCount} />

      <div data-testid="rp-main-row" style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10, minHeight: 0 }}>
        <LeftTelemetry nodes={activeNodes} edgeCount={activeEdges.length} depth={depth} debtCount={debtCount} />

        {/* ── CENTER ── */}
        <div data-testid="rp-center" style={{
          flex: 1, minWidth: 0,
          margin: "10px 0",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(120,170,210,0.02) 55%, rgba(255,255,255,0.015))",
          backdropFilter: "blur(16px) saturate(140%) brightness(1.04)",
          WebkitBackdropFilter: "blur(16px) saturate(140%) brightness(1.04)",
          boxShadow: "0 10px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
          display: "flex", flexDirection: "column",
          alignItems: "center",
          justifyContent: phase === "graph" ? "flex-start" : "center",
          padding: "1.5rem 2rem",
          paddingTop: phase === "graph" ? "1.25rem" : "1.5rem",
          position: "relative",
          overflowX: "hidden",
          overflowY: "auto",
          boxSizing: "border-box",
        }}>
          <ScanLine active={phase === "replay"} />

          {/* Targeting rings — intro / replay only */}
          {(phase === "intro" || phase === "replay") && (
            <>
              <div style={{ position:"absolute", width:380, height:380, borderRadius:"50%", border:`0.5px solid rgba(20,70,110,0.22)`, pointerEvents:"none" }} />
              <div style={{ position:"absolute", width:260, height:260, borderRadius:"50%", border:`0.5px solid rgba(20,70,110,0.16)`, pointerEvents:"none" }} />
              <div style={{ position:"absolute", width:16, height:16, pointerEvents:"none", top:"50%", left:"50%", transform:"translate(-50%,-50%)" }}>
                <div style={{ position:"absolute", top:0, left:"50%", width:"0.5px", height:6, background:C.cyanDim, transform:"translateX(-50%)" }} />
                <div style={{ position:"absolute", bottom:0, left:"50%", width:"0.5px", height:6, background:C.cyanDim, transform:"translateX(-50%)" }} />
                <div style={{ position:"absolute", left:0, top:"50%", width:6, height:"0.5px", background:C.cyanDim, transform:"translateY(-50%)" }} />
                <div style={{ position:"absolute", right:0, top:"50%", width:6, height:"0.5px", background:C.cyanDim, transform:"translateY(-50%)" }} />
              </div>
            </>
          )}

          {/* INGEST */}
          {phase === "ingest" && (
            <IngestScreen onLoad={nodes => {
              setActiveNodes(nodes);
              setSelectedNode(findPrimaryDecision(nodes));
              setPanelOpen(false);
              setPhase("intro");
            }} />
          )}

          {/* INTRO */}
          {phase === "intro" && (() => {
            const n = selectedNode !== null ? activeNodes[selectedNode] : null;
            return (
              <div style={{ width:"100%", maxWidth:680, display:"flex", flexDirection:"column", alignItems:"center" }}>
                {n ? (
                  <>
                    <div style={s.hugeText}>
                      {n.id}
                      <br />
                      <span style={{ fontSize: 18, color: C.textDim }}>{n.what}</span>
                    </div>
                    <div style={s.label}>node selected — ready to reconstruct</div>
                    <button style={s.ghostBtn} onClick={() => setPhase("replay")}>
                      REPLAY MEMORY ↗
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ ...s.hugeText, color: C.textDim, fontSize: 20 }}>
                      no node selected
                    </div>
                    <div style={s.label}>← select an artifact from the list to begin</div>
                  </>
                )}
              </div>
            );
          })()}

          {/* REPLAY */}
          {phase === "replay" && (
            <div style={{ width:"100%", maxWidth:680, display:"flex", flexDirection:"column", alignItems:"center" }}>
              <div style={{ ...s.midText, opacity: replayVisible ? 1 : 0, transition: "opacity 0.25s" }}>
                {step?.text}
              </div>
              <div style={{ ...s.label, marginTop: 6, opacity: replayVisible ? 1 : 0, transition: "opacity 0.25s" }}>
                {step?.sub}
              </div>
              <div style={s.progressBar}>
                <div style={{ ...s.progressFill, width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* GRAPH */}
          {phase === "graph" && (
            <div style={{ width:"100%", maxWidth:680, display:"flex", flexDirection:"column" }}>
              <GraphSVG
                nodes={activeNodes} edges={activeEdges}
                selected={selectedNode}
                onSelect={i => {
                  if (i !== null) { setSelectedNode(i); setPanelOpen(true); }
                  else            { setPanelOpen(false); }
                }}
              />
              <GlobalCriticSummary nodes={activeNodes} />
              {panelOpen && selectedNode !== null && (
                <DetailPanel node={activeNodes[selectedNode]} onClose={() => setPanelOpen(false)} />
              )}
              {panelOpen && selectedNode !== null ? (
                <ReconstructedMemory
                  key={selectedNode}
                  node={activeNodes[selectedNode]}
                  allNodes={activeNodes}
                />
              ) : (
                <div style={{ marginTop: 28, textAlign: "center", fontSize: 11, color: C.textDim, letterSpacing: "0.16em" }}>
                  click a node to open reconstruction
                </div>
              )}
              {selectedNode !== null && (
                <AICriticReport
                  key={selectedNode}
                  node={activeNodes[selectedNode]}
                  linked={getLinkedNodes(selectedNode, activeNodes, activeEdges)}
                />
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <ExportButton nodes={activeNodes} edges={activeEdges} />
                <button
                  style={{ ...s.smBtn, color: C.cyan, borderColor: C.cyanDim, opacity: 0.85 }}
                  onClick={() => { setPhase("ingest"); setActiveNodes([]); setSelectedNode(null); setPanelOpen(false); }}
                >
                  ↺ reset
                </button>
              </div>
            </div>
          )}
        </div>

        <RightSystem nodes={activeNodes} selectedNode={selectedNode} onSelect={i => {
          setSelectedNode(i);
          if (phase === "graph") setPanelOpen(true);
        }} />
      </div>

      <BottomBar />
    </div>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function ScanLine({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, height: 1, zIndex: 5, pointerEvents: "none",
      background: `linear-gradient(90deg, transparent 0%, ${C.cyan} 50%, transparent 100%)`,
      boxShadow: `0 0 10px ${C.cyan}`,
      animation: "scan 2.2s linear infinite",
    }} />
  );
}

interface NodeData {
  id: string; tag: string;
  x: number; y: number; w: number; h: number;
  who: string; when: string; what: string;
  signals: string[]; alts: string[]; lost: string;
}

function GraphSVG({ nodes, edges, selected, onSelect }: {
  nodes: NodeData[];
  edges: { from: number; to: number }[];
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  // show only the connected subgraph of the selected node; full graph otherwise
  const visibleSet: Set<number> = selected !== null
    ? getConnectedIndices(selected, edges)
    : new Set(nodes.map((_, i) => i));

  const visibleNodes   = nodes.filter((_, i) => visibleSet.has(i));
  const visibleEdges   = edges.filter(e => visibleSet.has(e.from) && visibleSet.has(e.to));

  // viewBox auto-fits visible nodes
  const PAD = 28;
  let vbX = 0, vbY = 0, vbW = 680, vbH = 260;
  if (visibleNodes.length > 0) {
    vbX = Math.min(...visibleNodes.map(n => n.x)) - PAD;
    vbY = Math.min(...visibleNodes.map(n => n.y)) - PAD;
    vbW = Math.max(...visibleNodes.map(n => n.x + n.w)) + PAD - vbX;
    vbH = Math.max(...visibleNodes.map(n => n.y + n.h)) + PAD - vbY;
  }

  // SVG height tracks aspect ratio, capped so it never becomes absurdly tall
  const svgH = Math.min(420, Math.max(200, Math.round(640 * vbH / Math.max(vbW, 1))));

  return (
    <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
         style={{ width: "100%", height: svgH, display: "block" }}>
      <defs>
        <marker id="arr" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5 z" fill={C.cyanDim} />
        </marker>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {visibleEdges.map((e, i) => {
        const f = nodes[e.from], t = nodes[e.to];
        const hot = selected !== null && (e.from === selected || e.to === selected);
        return (
          <line key={i}
            x1={f.x + f.w/2} y1={f.y + f.h/2}
            x2={t.x - 4}     y2={t.y + t.h/2}
            stroke={hot ? C.cyan : C.cyanDim}
            strokeWidth={hot ? 1 : 0.5}
            strokeDasharray="4 4"
            markerEnd="url(#arr)"
          />
        );
      })}
      {nodes.map((n, i) => {
        if (!visibleSet.has(i)) return null;
        const isD  = n.tag === "decision";
        const isSel = selected === i;
        return (
          <g key={i} onClick={() => onSelect(isSel ? null : i)} style={{ cursor: "pointer" }}>
            <rect
              x={n.x} y={n.y} width={n.w} height={n.h} rx={2}
              fill={isD ? C.bgPanelHi : C.bgPanel}
              stroke={isSel ? C.cyan : isD ? C.borderHi : C.border}
              strokeWidth={isSel ? 2 : isD ? 0.8 : 0.5}
              filter={isSel ? "url(#glow)" : undefined}
            />
            <text x={n.x+n.w/2} y={n.y+n.h/2-6}
              fontFamily={C.font} fontSize={isSel ? 14 : 13} fontWeight={isSel ? 700 : 500}
              fill={isSel ? C.cyan : isD ? C.text : "#4a7a94"} textAnchor="middle">
              {n.id}
            </text>
            <text x={n.x+n.w/2} y={n.y+n.h/2+9}
              fontFamily={C.font} fontSize={10} fill={C.textDim}
              textAnchor="middle" letterSpacing={1}>
              {n.tag}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DetailPanel({ node, onClose }: { node: NodeData; onClose: () => void }) {
  return (
    <div style={s.panel}>
      <div style={{ ...s.panelHeader, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={s.panelId}>{node.id}</span>
          <span style={s.panelTag}>{node.tag}</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, fontSize: 16, lineHeight: 1, padding: "0 2px" }}
          title="close"
        >×</button>
      </div>
      <div style={s.panelBody}>
        <div style={s.row}>
          <div style={s.key}>что</div>
          <div style={s.val}>{node.what}</div>
        </div>
        <div style={s.row}>
          <div style={s.key}>кто · когда</div>
          <div style={s.val}>{node.who} · {node.when}</div>
        </div>
        {node.signals.length > 0 && (
          <div style={s.row}>
            <div style={s.key}>сигналы</div>
            <div style={s.val}>{node.signals.map(sig => <span key={sig} style={s.signal}>{sig}</span>)}</div>
          </div>
        )}
        {node.alts.length > 0 && (
          <div style={s.row}>
            <div style={s.key}>отпало</div>
            <div style={s.val}>{node.alts.map(a => <span key={a} style={s.alt}>{a}</span>)}</div>
          </div>
        )}
        {node.lost && (
          <div style={s.row}>
            <div style={s.key}>утеряно</div>
            <div style={{ ...s.val, ...s.lost }}>{node.lost}</div>
          </div>
        )}
      </div>
      <div style={s.panelFooter}>
        <span style={s.footerLabel}>dig deeper</span>
        <button style={s.smBtn} onClick={onClose}>close ×</button>
      </div>
    </div>
  );
}

// ─── TYPEWRITER HOOK ──────────────────────────────────────────────────────────

function useTypewriter(text: string, delayMs = 450) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    if (!text) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      let pos = 0;
      intervalId = setInterval(() => {
        pos = Math.min(pos + 2, text.length);
        setDisplayed(text.slice(0, pos));
        if (pos >= text.length) {
          setDone(true);
          clearInterval(intervalId!);
        }
      }, 10);
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [text, delayMs]);

  return { displayed, done };
}

// ─── RECONSTRUCTED MEMORY ─────────────────────────────────────────────────────

function ReconstructedMemory({ node, allNodes }: { node: NodeData; allNodes: NodeData[] }) {
  const fullText = buildReconstruction(node, allNodes);
  const { displayed, done } = useTypewriter(fullText);
  const [copied,   setCopied]   = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(id);
  }, []);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(fullText); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const confidenceColor =
    fullText.includes("Confidence: HIGH") ? C.green :
    fullText.includes("Confidence: LOW")  ? C.red   : C.amber;

  return (
    <div style={{
      marginTop: 20,
      border: `0.5px solid ${C.cyanDim}`,
      background: "rgba(1,5,11,0.95)",
      position: "relative",
      opacity:    revealed ? 1 : 0,
      transform:  revealed ? "translateY(0)" : "translateY(18px)",
      transition: "opacity 0.55s ease, transform 0.55s ease",
      boxShadow: `0 0 32px rgba(79,195,247,0.07), inset 0 0 40px rgba(2,10,20,0.8)`,
    }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: "9px 14px",
        borderBottom: `0.5px solid ${C.cyanDim}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(8,22,38,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: C.cyan,
            boxShadow: `0 0 6px ${C.cyan}, 0 0 14px ${C.cyanGlow}`,
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.32em",
            color: C.cyan, textShadow: `0 0 14px ${C.cyanGlow}`,
          }}>
            RECONSTRUCTED MEMORY
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em" }}>{node.id}</span>
          <div style={{ width: "0.5px", height: 10, background: C.border }} />
          <span style={{
            fontSize: 9, letterSpacing: "0.22em",
            color: done ? C.green : C.cyanDim,
            transition: "color 0.4s",
          }}>
            {done ? "COMPLETE" : "RECONSTRUCTING..."}
          </span>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{
        padding: "16px 18px", position: "relative", minHeight: 80,
        backgroundImage: "repeating-linear-gradient(0deg,transparent 0px,transparent 3px,rgba(0,0,0,0.04) 3px,rgba(0,0,0,0.04) 4px)",
      }}>
        <Brackets size={11} color="rgba(15,55,90,0.45)" />

        <pre style={{
          fontFamily: C.font, fontSize: 13, lineHeight: 1.8,
          color: C.text, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
          textShadow: "0 0 14px rgba(79,195,247,0.1)",
        }}>
          {displayed}
          {!done && (
            <span style={{
              display: "inline-block", width: 7, height: 12,
              background: C.cyan, marginLeft: 1,
              animation: "blink-cursor 0.7s step-end infinite",
              verticalAlign: "middle",
              boxShadow: `0 0 8px ${C.cyan}`,
            }} />
          )}
        </pre>

        {done && (
          <div style={{
            marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
            padding: "4px 12px",
            border: `0.5px solid ${confidenceColor}`,
            background: `${confidenceColor}18`,
            boxShadow: `0 0 12px ${confidenceColor}22`,
          }}>
            <div style={{
              width: 4, height: 4, borderRadius: "50%",
              background: confidenceColor, boxShadow: `0 0 6px ${confidenceColor}`,
            }} />
            <span style={{ fontSize: 10, color: confidenceColor, letterSpacing: "0.24em", fontWeight: 600 }}>
              RECONSTRUCTION VERIFIED
            </span>
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      {done && (
        <div style={{
          padding: "9px 16px",
          borderTop: `0.5px solid rgba(15,55,90,0.5)`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>
            SOURCE · ARTIFACT GRAPH · SIGNAL TRACES · CONTEXT RECOVERY
          </span>
          <button
            onClick={handleCopy}
            style={{
              padding: "5px 14px", fontSize: 11, letterSpacing: "0.2em",
              background: copied ? `${C.green}1a` : "transparent",
              border: `0.5px solid ${copied ? C.green : C.cyanDim}`,
              color: copied ? C.green : C.cyan,
              cursor: "pointer", fontFamily: C.font, borderRadius: 0,
              transition: "all 0.3s",
              boxShadow: copied ? `0 0 10px ${C.green}33` : `0 0 8px ${C.cyanGlow}`,
            }}
          >
            {copied ? "✓  COPIED" : "[ COPY RECONSTRUCTION ]"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AI CRITIC REPORT ─────────────────────────────────────────────────────────

function CriticBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.24em", marginBottom: 6 }}>{label}</div>
      {items.length > 0 ? (
        items.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 4 }}>
            <span style={{ color: C.cyanDim, fontSize: 12, lineHeight: 1.6, flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{it}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: "0.04em", fontStyle: "italic" }}>{empty}</div>
      )}
    </div>
  );
}

function AICriticReport({ node, linked }: { node: NodeData; linked: NodeData[] }) {
  const [report,  setReport]  = useState<CriticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [source,  setSource]  = useState<"mocked" | "openbmb">("mocked");

  // Re-run the critic whenever the selected node (or its links) change.
  // Keyed on stable ids — `linked` is a fresh array each render, so depending on
  // the reference would re-fire on every parent tick.
  const linkedKey = linked.map(n => n.id).join(",");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReport(null);
    fetch("/api/critic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node, linked }),
    })
      .then(res => res.json())
      .then(({ report: r, source: s }: { report: CriticReport; source: "mocked" | "openbmb" }) => {
        if (!cancelled) { setReport(r); setSource(s); setLoading(false); }
      })
      .catch(() => {
        // Network error: run mock locally so the UI never shows broken.
        runCritic({ node, linked }).then(r => {
          if (!cancelled) { setReport(r); setSource("mocked"); setLoading(false); }
        });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, linkedKey]);

  const riskColor =
    report?.debtRisk === "HIGH"   ? C.red :
    report?.debtRisk === "MEDIUM" ? C.amber : C.green;

  const confidencePct = report ? Math.round(report.confidence * 100) : 0;

  return (
    <div style={{
      marginTop: 20,
      border: `0.5px solid ${C.cyanDim}`,
      background: "rgba(1,5,11,0.95)",
      position: "relative",
      boxShadow: `0 0 32px rgba(79,195,247,0.07), inset 0 0 40px rgba(2,10,20,0.8)`,
    }}>
      {/* ── HEADER ── */}
      <div style={{
        padding: "9px 14px",
        borderBottom: `0.5px solid ${C.cyanDim}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(8,22,38,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: C.cyan,
            boxShadow: `0 0 6px ${C.cyan}, 0 0 14px ${C.cyanGlow}`,
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.32em",
            color: C.cyan, textShadow: `0 0 14px ${C.cyanGlow}`,
          }}>
            AI CRITIC REPORT
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em" }}>{node.id}</span>
          <div style={{ width: "0.5px", height: 10, background: C.border }} />
          <span style={{
            fontSize: 9, letterSpacing: "0.22em",
            color: loading ? C.cyanDim : C.green,
            transition: "color 0.4s",
          }}>
            {loading ? "REVIEWING..." : "COMPLETE"}
          </span>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: "16px 18px", position: "relative", minHeight: 80 }}>
        <Brackets size={11} color="rgba(15,55,90,0.45)" />

        {loading || !report ? (
          <div style={{ fontSize: 13, color: C.textDim, letterSpacing: "0.08em" }}>
            scanning reasoning for gaps…
          </div>
        ) : (
          <>
            <CriticBlock label="MISSING CONTEXT"    items={report.missingContext}     empty="none detected" />
            <CriticBlock label="WEAK ASSUMPTIONS"   items={report.weakAssumptions}    empty="none detected" />

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.24em", marginBottom: 6 }}>DEBT RISK</div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "4px 12px",
                border: `0.5px solid ${riskColor}`,
                background: `${riskColor}18`,
                boxShadow: `0 0 12px ${riskColor}22`,
              }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: riskColor, boxShadow: `0 0 6px ${riskColor}` }} />
                <span style={{ fontSize: 11, color: riskColor, letterSpacing: "0.24em", fontWeight: 600 }}>
                  {report.debtRisk}
                </span>
              </div>
            </div>

            <CriticBlock label="SUGGESTED ARTIFACTS" items={report.suggestedArtifacts} empty="no additional artifacts suggested" />

            <div>
              <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.24em", marginBottom: 6 }}>CONFIDENCE</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: "2px", background: C.border, position: "relative" }}>
                  <div style={{ height: "2px", width: `${confidencePct}%`, background: C.cyan, boxShadow: `0 0 8px ${C.cyan}`, transition: "width 0.4s" }} />
                </div>
                <span style={{ fontSize: 13, color: C.cyan, fontVariantNumeric: "tabular-nums", letterSpacing: "0.06em" }}>
                  {confidencePct}%
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        padding: "9px 16px",
        borderTop: `0.5px solid rgba(15,55,90,0.5)`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 9, color: source === "openbmb" ? C.green : C.textDim, letterSpacing: "0.1em" }}>
          {`CRITIC · OpenBMB MiniCPM4-8B · ${source === "openbmb" ? "LIVE" : "MOCKED"}`}
        </span>
        <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>
          {linked.length} LINKED ARTIFACT{linked.length === 1 ? "" : "S"}
        </span>
      </div>
    </div>
  );
}

// ─── GLOBAL CRITIC SUMMARY (DATASET-LEVEL) ────────────────────────────────────

function GlobalStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      border: `0.5px solid ${C.border}`,
      background: "rgba(8,22,38,0.45)",
      padding: "10px 12px",
    }}>
      <div style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.2em", marginBottom: 6, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 22, color, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function GlobalCriticSummary({ nodes }: { nodes: NodeData[] }) {
  // Deterministic + synchronous — recompute only when the dataset identity
  // changes (keyed on stable ids, not the fresh array reference each render).
  const idKey = nodes.map(n => n.id).join(",");
  const summary: GlobalCriticSummary = useMemo(
    () => buildGlobalSummary(nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idKey],
  );

  const confidencePct = Math.round(summary.overallConfidence * 100);
  const confColor = confidencePct >= 66 ? C.green : confidencePct >= 40 ? C.amber : C.red;
  const debtColor = summary.totalDebtMarkers > 0 ? C.amber : C.green;

  return (
    <div style={{
      marginTop: 20,
      border: `0.5px solid ${C.cyanDim}`,
      background: "rgba(1,5,11,0.95)",
      position: "relative",
      boxShadow: `0 0 32px rgba(79,195,247,0.07), inset 0 0 40px rgba(2,10,20,0.8)`,
    }}>
      {/* ── HEADER ── */}
      <div style={{
        padding: "9px 14px",
        borderBottom: `0.5px solid ${C.cyanDim}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(8,22,38,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: C.cyan,
            boxShadow: `0 0 6px ${C.cyan}, 0 0 14px ${C.cyanGlow}`,
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.32em",
            color: C.cyan, textShadow: `0 0 14px ${C.cyanGlow}`,
          }}>
            GLOBAL CRITIC SUMMARY
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em" }}>DATASET</span>
          <div style={{ width: "0.5px", height: 10, background: C.border }} />
          <span style={{ fontSize: 9, letterSpacing: "0.22em", color: C.green }}>COMPLETE</span>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ padding: "16px 18px", position: "relative", minHeight: 80 }}>
        <Brackets size={11} color="rgba(15,55,90,0.45)" />

        {/* Stats */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <GlobalStat label="ARTIFACTS ANALYZED"     value={summary.totalArtifacts}   color={C.cyan} />
          <GlobalStat label="DECISIONS FOUND"        value={summary.totalDecisions}   color={C.text} />
          <GlobalStat label="REASONING DEBT MARKERS" value={summary.totalDebtMarkers} color={debtColor} />
        </div>

        {/* Highest risk artifacts */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.24em", marginBottom: 6 }}>HIGHEST RISK ARTIFACTS</div>
          {summary.highRiskArtifacts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {summary.highRiskArtifacts.map((id) => (
                <span key={id} style={{
                  fontSize: 12, color: C.red, letterSpacing: "0.08em",
                  padding: "3px 9px",
                  border: `0.5px solid ${C.red}`,
                  background: `${C.red}14`,
                  boxShadow: `0 0 10px ${C.red}1a`,
                  fontVariantNumeric: "tabular-nums",
                }}>{id}</span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textDim, fontStyle: "italic" }}>none detected</div>
          )}
        </div>

        <CriticBlock label="KEY FINDINGS"    items={summary.keyFindings}     empty="no systemic gaps detected" />
        <CriticBlock label="RECOMMENDATIONS" items={summary.recommendations} empty="reasoning record is well documented" />

        {/* Overall confidence */}
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.24em", marginBottom: 6 }}>OVERALL CONFIDENCE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: "2px", background: C.border, position: "relative" }}>
              <div style={{ height: "2px", width: `${confidencePct}%`, background: confColor, boxShadow: `0 0 8px ${confColor}`, transition: "width 0.4s" }} />
            </div>
            <span style={{ fontSize: 13, color: confColor, fontVariantNumeric: "tabular-nums", letterSpacing: "0.06em" }}>
              {confidencePct}%
            </span>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        padding: "9px 16px",
        borderTop: `0.5px solid rgba(15,55,90,0.5)`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>
          CRITIC · DATASET-LEVEL · deterministic
        </span>
        <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.1em" }}>
          COMPANION TO PER-NODE REPORT
        </span>
      </div>
    </div>
  );
}

// ─── EXPORT AUDIT REPORT ─────────────────────────────────────────────────────

function buildAuditMarkdown(
  nodes: NodeData[],
  edges: { from: number; to: number }[],
  globalSummary: GlobalCriticSummary,
  perNodeReports: Map<string, { report: CriticReport; source: string }>,
  timestamp: string,
): string {
  const summary = computeSummary(nodes);
  const confPct = Math.round(globalSummary.overallConfidence * 100);
  const lines: string[] = [];

  lines.push("# REASONING PROJECTOR — AUDIT REPORT");
  lines.push("");
  lines.push(`> Generated: ${timestamp}`);
  lines.push("> Tool: Reasoning Projector v0.1.0");
  lines.push("");
  lines.push("---");
  lines.push("");

  // 1. Dataset Summary
  lines.push("## 1. Dataset Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Artifacts | ${summary.artifacts} |`);
  lines.push(`| Signals (Edges) | ${summary.signals} |`);
  lines.push(`| Decisions | ${summary.decisions} |`);
  lines.push(`| Debt Markers | ${summary.debt} |`);
  lines.push("");

  // 2. Global Critic Summary
  lines.push("## 2. Global Critic Summary");
  lines.push("");
  lines.push(`**Overall Confidence:** ${confPct}%`);
  lines.push("");

  // 3. Key Findings
  lines.push("## 3. Key Findings");
  lines.push("");
  if (globalSummary.keyFindings.length > 0) {
    globalSummary.keyFindings.forEach(f => lines.push(`- ${f}`));
  } else {
    lines.push("*No systemic gaps detected.*");
  }
  lines.push("");

  // 4. Recommendations
  lines.push("## 4. Recommendations");
  lines.push("");
  if (globalSummary.recommendations.length > 0) {
    globalSummary.recommendations.forEach(r => lines.push(`- ${r}`));
  } else {
    lines.push("*Reasoning record is well documented.*");
  }
  lines.push("");

  // 5. Highest Risk Artifacts
  lines.push("## 5. Highest Risk Artifacts");
  lines.push("");
  if (globalSummary.highRiskArtifacts.length > 0) {
    globalSummary.highRiskArtifacts.forEach(id => lines.push(`- \`${id}\``));
  } else {
    lines.push("*None detected.*");
  }
  lines.push("");

  // 6. Per-node AI Critic Reports
  lines.push("## 6. Per-Node AI Critic Reports");
  lines.push("");

  nodes.forEach(node => {
    lines.push(`### ${node.id}`);
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|-------|-------|");
    lines.push(`| Tag | \`${node.tag}\` |`);
    lines.push(`| Author | ${node.who} |`);
    lines.push(`| Date | ${node.when} |`);
    lines.push("");
    lines.push(`**Description:** ${node.what}`);
    lines.push("");
    if (node.signals.length > 0) {
      lines.push(`**Signals:** ${node.signals.map(s => `\`${s}\``).join(", ")}`);
      lines.push("");
    }
    if (node.alts.length > 0) {
      lines.push("**Rejected Alternatives:**");
      node.alts.forEach(a => lines.push(`- ${a}`));
      lines.push("");
    }
    if (node.lost) {
      lines.push(`**Reasoning Debt:** ${node.lost}`);
      lines.push("");
    }

    const entry = perNodeReports.get(node.id);
    if (entry) {
      const { report, source } = entry;
      const confNodePct = Math.round(report.confidence * 100);
      lines.push("**AI Critic Analysis:**");
      lines.push("");
      if (report.missingContext.length > 0) {
        lines.push("*Missing Context:*");
        report.missingContext.forEach(i => lines.push(`- ${i}`));
        lines.push("");
      }
      if (report.weakAssumptions.length > 0) {
        lines.push("*Weak Assumptions:*");
        report.weakAssumptions.forEach(i => lines.push(`- ${i}`));
        lines.push("");
      }
      lines.push(`*Debt Risk:* **${report.debtRisk}**`);
      lines.push("");
      if (report.suggestedArtifacts.length > 0) {
        lines.push("*Suggested Artifacts:*");
        report.suggestedArtifacts.forEach(i => lines.push(`- ${i}`));
        lines.push("");
      }
      lines.push(`*Confidence:* ${confNodePct}%`);
      lines.push(`*Source:* ${source}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  });

  lines.push("");
  lines.push("*Generated by Reasoning Projector v0.1.0 — Decision Intelligence System*");
  return lines.join("\n");
}

function ExportButton({ nodes, edges }: { nodes: NodeData[]; edges: { from: number; to: number }[] }) {
  const [exporting, setExporting] = useState(false);
  const [done,      setDone]      = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setDone(false);

    const globalSummary = buildGlobalSummary(nodes);
    const perNodeReports = new Map<string, { report: CriticReport; source: string }>();

    await Promise.all(
      nodes.map(async (node, nodeIdx) => {
        const linked = getLinkedNodes(nodeIdx, nodes, edges);
        try {
          const res = await fetch("/api/critic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ node, linked }),
          });
          const { report, source } = await res.json() as { report: CriticReport; source: string };
          perNodeReports.set(node.id, { report, source });
        } catch {
          const report = await runCritic({ node, linked });
          perNodeReports.set(node.id, { report, source: "mocked" });
        }
      })
    );

    const now = new Date();
    const timestamp = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const markdown = buildAuditMarkdown(nodes, edges, globalSummary, perNodeReports, timestamp);

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reasoning-audit-report.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExporting(false);
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      style={{
        ...s.smBtn,
        color:       done ? C.green : exporting ? C.textDim : C.cyan,
        borderColor: done ? C.green : exporting ? C.border  : C.cyanDim,
        opacity: exporting ? 0.65 : 1,
        cursor:  exporting ? "default" : "pointer",
      }}
    >
      {done ? "✓ EXPORTED" : exporting ? "GENERATING…" : "↓ EXPORT REPORT"}
    </button>
  );
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
