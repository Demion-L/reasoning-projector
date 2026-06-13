// ─── AI CRITIC · SHARED TYPES ──────────────────────────────────────────────────
//
// The critic reviews the *reasoning* captured by a graph node and its linked
// context, surfacing gaps a human reviewer would flag in a decision record.
//
// These types are intentionally self-contained so the pipeline has no dependency
// on the UI layer. `CriticNode` is structurally compatible with the `NodeData`
// shape used in app/page.tsx — callers can pass their nodes directly.

export interface CriticNode {
  id: string;
  tag: string;
  who: string;
  when: string;
  what: string;
  signals: string[];
  alts: string[];
  lost: string;
}

/** What the critic is asked to review: the focus node plus everything it links to. */
export interface CriticInput {
  /** The node currently under review. */
  node: CriticNode;
  /** Directly linked nodes (referenced-by-signal in either direction). */
  linked: CriticNode[];
}

export type DebtRisk = "LOW" | "MEDIUM" | "HIGH";

/** Structured verdict produced by the critic for a single node. */
export interface CriticReport {
  missingContext: string[];
  weakAssumptions: string[];
  debtRisk: DebtRisk;
  suggestedArtifacts: string[];
  /** 0..1 — the critic's confidence in its own review. */
  confidence: number;
}

/**
 * A pluggable model backend. Given a prompt, returns the raw model text.
 * The default implementation is mocked; a real OpenBMB call drops in here later
 * without touching buildCriticPrompt / parseCriticResponse / the UI.
 */
export type CriticProvider = (prompt: string) => Promise<string>;

// ── Executive Summary ────────────────────────────────────────────────────────

export type HealthStatus = "NOMINAL" | "DEGRADED" | "CRITICAL";
export type ExecutiveRiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Top-level reasoning-health verdict for use in reports and the UI header. */
export interface ExecutiveSummary {
  status: HealthStatus;
  riskLevel: ExecutiveRiskLevel;
  headline: string;
  /** Ordered narrative sentences — render as a bullet list or paragraphs. */
  body: string[];
  confidencePct: number;
}

// ── Remediation Plan ─────────────────────────────────────────────────────────

export type RemediationPriority = "P1" | "P2" | "P3";

export interface RemediationItem {
  priority: RemediationPriority;
  /** The actionable step to take. */
  action: string;
  /** Why this item matters — one sentence derived from findings. */
  rationale: string;
  /** Artifact IDs this item directly addresses (may be empty for process items). */
  affected: string[];
  effort: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Project-level reasoning-health verdict for an entire loaded dataset.
 *
 * This is the dataset-level companion to the per-node `CriticReport`: where the
 * report scrutinises one artifact, this aggregates reasoning debt across all of
 * them. It is produced deterministically (no model) by `buildGlobalSummary`.
 */
export interface GlobalCriticSummary {
  /** Total nodes/artifacts in the dataset. */
  totalArtifacts: number;
  /** How many of those are decision nodes. */
  totalDecisions: number;
  /** Count of artifacts carrying at least one reasoning-debt marker. */
  totalDebtMarkers: number;
  /** Ids of the artifacts most likely to hide a costly reasoning gap. */
  highRiskArtifacts: string[];
  /** Human-readable observations about systemic reasoning gaps. */
  keyFindings: string[];
  /** Concrete, actionable steps to repair the reasoning record. */
  recommendations: string[];
  /** 0..1 — confidence that the dataset's reasoning is well documented. */
  overallConfidence: number;
}
