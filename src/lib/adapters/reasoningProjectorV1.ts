// ─── Reasoning Projector v1 Schema Adapter ───────────────────────────────────
//
// Converts a `$schema: "reasoning-projector/v1"` export into the flat
// NodeData[] that the graph engine consumes.  Structural field names follow
// the v1 export convention; optional fields fall back to sensible defaults.

/** Mirrors app/page.tsx interface NodeData. Kept local to avoid a cross-layer import. */
export interface AdaptedNode {
  id: string; tag: string;
  x: number; y: number; w: number; h: number;
  who: string; when: string; what: string;
  signals: string[]; alts: string[]; lost: string;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const COL = { incident: 60, investigation: 240, finding: 420, decision: 600 } as const;
const ROW_H    = 70;
const NODE_W   = 140;
const NODE_H   = 46;
const ROW_Y0   = 80;

function pos(col: number, row: number) {
  return { x: col, y: ROW_Y0 + row * ROW_H, w: NODE_W, h: NODE_H };
}

// ─── Field helpers ────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function str(v: unknown, ...fallbacks: unknown[]): string {
  if (typeof v === "string" && v) return v;
  for (const f of fallbacks) if (typeof f === "string" && f) return f;
  return "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).flatMap(s => (typeof s === "string" && s ? [s] : []));
}

// ─── Sub-adapters ─────────────────────────────────────────────────────────────

function adaptDecision(d: Raw, row: number): AdaptedNode {
  const id = str(d.decision_id, d.id) || `DEC-${row + 1}`;

  const signals: string[] = [
    ...strArr(d.related_findings),
    ...strArr(d.related_investigations),
    ...strArr(d.related_prs),
  ];

  const alts: string[] = [];
  if (Array.isArray(d.alternatives)) {
    for (const raw of d.alternatives as Raw[]) {
      const option  = str(raw.option, raw.text, raw.name);
      const verdict = str(raw.verdict);
      const reason  = str(raw.reason, raw.rationale);
      if (!option) continue;
      const parts = [option, verdict ? `(${verdict})` : "", reason ? `— ${reason}` : ""].filter(Boolean);
      alts.push(parts.join(" "));
    }
  }

  return {
    id, tag: "decision",
    ...pos(COL.decision, row),
    who:     str(d.who, "architecture"),
    when:    str(d.generated_at, d.decided_at),
    what:    str(d.title, d.description, id),
    signals, alts,
    lost:    str(d.selected_rationale) ? "" : "Decision rationale missing",
  };
}

function adaptInvestigation(inv: Raw, row: number): AdaptedNode {
  const id = str(inv.investigation_id, inv.id) || `INV-${row + 1}`;
  const resolved = !!(str(inv.finding) || str(inv.resolution) || str(inv.result));

  return {
    id, tag: "investigation",
    ...pos(COL.investigation, row),
    who:     str(inv.conducted_by, inv.who, "team"),
    when:    str(inv.generated_at, inv.started_at),
    what:    str(inv.title, inv.description, id),
    signals: [],
    alts:    [],
    lost:    resolved ? "" : "Investigation has no recorded finding or resolution",
  };
}

function adaptFinding(f: Raw, row: number): AdaptedNode {
  const id = str(f.finding_id, f.id) || `FIND-${row + 1}`;

  const signals: string[] = [];
  const pr     = str(f.pr, f.pull_request);
  const commit = str(f.commit, f.sha);
  if (pr)     signals.push(pr);
  if (commit) signals.push(commit);

  return {
    id, tag: "finding",
    ...pos(COL.finding, row),
    who:     str(f.raised_by, f.who, "team"),
    when:    str(f.generated_at, f.detected_at),
    what:    str(f.title, f.description, id),
    signals,
    alts:    [],
    lost:    str(f.resolution) ? "" : str(f.description, "Finding has no recorded resolution"),
  };
}

function adaptIncident(inc: Raw): AdaptedNode {
  const id = str(inc.id, inc.incident_id, "INCIDENT");

  return {
    id, tag: "incident",
    x: COL.incident, y: ROW_Y0, w: NODE_W, h: NODE_H,
    who:     str(inc.reported_by, inc.who, "team"),
    when:    str(inc.detected_at, inc.created_at, inc.when),
    what:    str(inc.title, inc.description, id),
    signals: strArr(inc.related_findings),
    alts:    [],
    lost:    str(inc.root_cause) ? "" : "Root cause missing",
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Converts a Reasoning Projector v1 document into a flat array of graph nodes.
 * Call only when `input.$schema === "reasoning-projector/v1"`.
 */
export function adaptReasoningProjectorV1(input: Record<string, unknown>): AdaptedNode[] {
  const nodes: AdaptedNode[] = [];

  if (input.incident && typeof input.incident === "object")
    nodes.push(adaptIncident(input.incident as Raw));

  if (Array.isArray(input.investigations))
    (input.investigations as Raw[]).forEach((inv, i) => nodes.push(adaptInvestigation(inv, i)));

  if (Array.isArray(input.findings))
    (input.findings as Raw[]).forEach((f, i) => nodes.push(adaptFinding(f, i)));

  if (Array.isArray(input.decision_graph))
    (input.decision_graph as Raw[]).forEach((d, i) => nodes.push(adaptDecision(d, i)));

  return nodes;
}
