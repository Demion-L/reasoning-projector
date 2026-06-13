// ─── AI CRITIC · GLOBAL (DATASET-LEVEL) SUMMARY ────────────────────────────────
//
// buildGlobalSummary() rolls the per-node reasoning-debt signals up to a
// project-level verdict: how much of the decision record is undocumented, which
// artifacts are riskiest, what the systemic gaps are, and what to do about them.
//
// It is fully DETERMINISTIC — no model, no randomness, no I/O. The same input
// always yields the same output, so it is the dataset-level companion to the
// (mock-or-model) per-node CriticReport and can run synchronously in the UI.

import type { CriticNode, GlobalCriticSummary } from "./types";

// Tags that represent downstream symptoms / incidents (as opposed to the
// decisions and records that should explain them).
const INCIDENT_TAGS = new Set(["bug", "fix", "invoice", "pr", "issue"]);

function hasLost(node: CriticNode): boolean {
  return typeof node.lost === "string" && node.lost.trim().length > 0;
}

function isDecision(node: CriticNode): boolean {
  return node.tag === "decision";
}

/**
 * A debt marker is present when the node's reasoning is demonstrably incomplete:
 *   - lost rationale is explicitly recorded, OR
 *   - a decision cites no upstream signals, OR
 *   - a decision records no rejected alternatives.
 */
function isDebtMarker(node: CriticNode): boolean {
  if (hasLost(node)) return true;
  if (isDecision(node) && node.signals.length === 0) return true;
  if (isDecision(node) && node.alts.length === 0) return true;
  return false;
}

/**
 * Does the lost-context text point at a *high-risk* gap — i.e. an unknown
 * source, a missing approval, an absent ADR, or an investigation that never
 * happened? These are the gaps most likely to cost real money to rediscover.
 */
function lostIndicatesHighRisk(lost: string): boolean {
  const t = lost.toLowerCase();
  if (!t.trim()) return false;
  return (
    /unknown source|source (is )?unknown|provenance|where it came from/.test(t) ||
    /approv/.test(t) ||                       // approval / approver / approved / sign-off
    /\badr\b|decision record/.test(t) ||      // no ADR / ADR left empty
    /investigat/.test(t)                      // never investigated / no investigation
  );
}

/** ISO `YYYY-MM-DD` strings sort lexicographically, so a plain compare works. */
function isLaterDate(a: string, b: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim() > b.trim();
}

/**
 * Aggregate reasoning health across every artifact in a loaded dataset.
 *
 * @param nodes The full set of graph nodes (NodeData is structurally compatible).
 */
export function buildGlobalSummary(nodes: CriticNode[]): GlobalCriticSummary {
  const totalArtifacts = nodes.length;

  // Empty dataset → a well-defined zero verdict (never throws / NaN).
  if (totalArtifacts === 0) {
    return {
      totalArtifacts: 0,
      totalDecisions: 0,
      totalDebtMarkers: 0,
      highRiskArtifacts: [],
      keyFindings: [],
      recommendations: [],
      overallConfidence: 0,
    };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Undirected adjacency by signal reference (matches the graph's edges, which
  // link a node to any artifact it cites and vice-versa).
  const neighbors = new Map<string, Set<string>>();
  nodes.forEach((n) => neighbors.set(n.id, new Set<string>()));
  nodes.forEach((n) => {
    n.signals.forEach((sig) => {
      if (byId.has(sig)) {
        neighbors.get(n.id)!.add(sig);
        neighbors.get(sig)!.add(n.id);
      }
    });
  });

  const decisions = nodes.filter(isDecision);
  const totalDecisions = decisions.length;
  const totalDebtMarkers = nodes.filter(isDebtMarker).length;

  // ── High-risk artifacts ──────────────────────────────────────────────────
  // Decision with no signals, or any node whose lost-context flags a high-risk
  // gap. Insertion order follows the dataset, so output is stable.
  const highRiskArtifacts: string[] = [];
  const seenRisk = new Set<string>();
  const flagRisk = (id: string) => {
    if (!seenRisk.has(id)) { seenRisk.add(id); highRiskArtifacts.push(id); }
  };
  nodes.forEach((n) => {
    if (isDecision(n) && n.signals.length === 0) flagRisk(n.id);
    if (hasLost(n) && lostIndicatesHighRisk(n.lost)) flagRisk(n.id);
  });

  // ── Undocumented decisions (used by findings + recommendations) ───────────
  const undocumentedDecisions = decisions.filter(
    (d) => hasLost(d) || d.alts.length === 0,
  );
  const undocumentedDecisionIds = new Set(undocumentedDecisions.map((d) => d.id));

  // Decisions whose recorded rationale is lost / never written down.
  const decisionsWithoutRationale = decisions.filter(
    (d) => hasLost(d) || d.signals.length === 0,
  );

  // Decisions that recorded no rejected alternatives.
  const decisionsMissingAlts = decisions.filter((d) => d.alts.length === 0);

  // Downstream incidents wired to an undocumented decision.
  const downstreamToUndocumented = nodes.filter(
    (n) =>
      INCIDENT_TAGS.has(n.tag) &&
      [...neighbors.get(n.id)!].some((adj) => undocumentedDecisionIds.has(adj)),
  );

  // ADRs created after the decision they document (retroactive paperwork).
  const lateAdrs = nodes.filter((n) => {
    if (n.tag !== "adr") return false;
    if (/after the fact|retroactiv|written later|created later/.test((n.lost || "").toLowerCase()))
      return true;
    return [...neighbors.get(n.id)!].some((adjId) => {
      const adj = byId.get(adjId);
      return adj !== undefined && isDecision(adj) && isLaterDate(n.when, adj.when);
    });
  });

  // ── Key findings ───────────────────────────────────────────────────────────
  const keyFindings: string[] = [];
  if (decisionsWithoutRationale.length > 0) {
    keyFindings.push(
      `${decisionsWithoutRationale.length} decision(s) recorded without documented rationale: ${decisionsWithoutRationale
        .map((d) => d.id)
        .join(", ")}`,
    );
  }
  if (downstreamToUndocumented.length > 0) {
    keyFindings.push(
      `${downstreamToUndocumented.length} downstream artifact(s) trace back to an undocumented decision: ${downstreamToUndocumented
        .map((n) => n.id)
        .join(", ")}`,
    );
  }
  if (lateAdrs.length > 0) {
    keyFindings.push(
      `${lateAdrs.length} ADR(s) appear to have been written after the fact: ${lateAdrs
        .map((n) => n.id)
        .join(", ")}`,
    );
  }
  if (decisionsMissingAlts.length > 0) {
    keyFindings.push(
      `${decisionsMissingAlts.length} decision(s) record no rejected alternatives: ${decisionsMissingAlts
        .map((d) => d.id)
        .join(", ")}`,
    );
  }

  // ── Recommendations ──────────────────────────────────────────────────────
  const recommendations: string[] = [];
  if (decisionsWithoutRationale.length > 0 || lateAdrs.length > 0) {
    recommendations.push(
      "Create ADR amendments capturing the lost rationale for the affected decisions.",
    );
  }
  if (decisionsMissingAlts.length > 0) {
    recommendations.push(
      "Document the rejected alternatives weighed for each decision that records none.",
    );
  }
  if (downstreamToUndocumented.length > 0 || decisions.some((d) => d.signals.length === 0)) {
    recommendations.push(
      "Link incident and PR artifacts to the decisions that motivated them.",
    );
  }
  const decisionsMissingOwner = decisions.filter(
    (d) => !d.who?.trim() || /approv|owner|sign-?off/.test((d.lost || "").toLowerCase()),
  );
  if (decisionsMissingOwner.length > 0) {
    recommendations.push(
      "Require an explicit owner/approver for operational decisions before they ship.",
    );
  }

  // ── Overall confidence ─────────────────────────────────────────────────────
  // Healthy when few artifacts carry debt and few are high-risk. Bounded so a
  // single dataset never reads as perfect (0.98) or hopeless (0.05).
  const debtRatio = totalDebtMarkers / totalArtifacts;
  const riskRatio = highRiskArtifacts.length / totalArtifacts;
  const raw = 1 - (0.55 * debtRatio + 0.35 * riskRatio);
  const overallConfidence = Number(Math.max(0.05, Math.min(0.98, raw)).toFixed(2));

  return {
    totalArtifacts,
    totalDecisions,
    totalDebtMarkers,
    highRiskArtifacts,
    keyFindings,
    recommendations,
    overallConfidence,
  };
}
