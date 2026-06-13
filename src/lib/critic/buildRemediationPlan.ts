// ─── AI CRITIC · REMEDIATION PLAN ───────────────────────────────────────────
//
// buildRemediationPlan() converts a GlobalCriticSummary into a prioritised,
// actionable list of remediation steps.
//
// Priority rules (first match wins per item):
//   P1 — Lost rationale / ADR gaps / direct high-risk artifact audit
//   P2 — Missing alternatives / unlinked downstream artifacts
//   P3 — Process improvements (ownership, traceability hygiene)
//
// Affected artifact IDs are extracted from the colon-delimited keyFindings
// strings produced by buildGlobalSummary (format: "... description: ID1, ID2").
//
// Fully DETERMINISTIC — no model, no randomness, no I/O.

import type {
  GlobalCriticSummary,
  RemediationItem,
  RemediationPriority,
} from "./types";

// keyFindings format: "... human text: ID1, ID2, ID3"
function extractIdsFromFinding(finding: string): string[] {
  const colonIdx = finding.lastIndexOf(": ");
  if (colonIdx < 0) return [];
  return finding
    .slice(colonIdx + 2)
    .split(", ")
    .map(s => s.trim())
    .filter(Boolean);
}

function priorityOf(rec: string): RemediationPriority {
  const l = rec.toLowerCase();
  if (/rationale|adr amendment/.test(l)) return "P1";
  if (/alternative|link incident|downstream/.test(l)) return "P2";
  return "P3";
}

function effortOf(p: RemediationPriority): "LOW" | "MEDIUM" | "HIGH" {
  return p === "P1" ? "HIGH" : p === "P2" ? "MEDIUM" : "LOW";
}

function rationaleFor(rec: string, s: GlobalCriticSummary): string {
  const l = rec.toLowerCase();
  if (/rationale|adr/.test(l)) {
    const n = s.keyFindings.filter(f =>
      /rationale|after the fact/.test(f.toLowerCase()),
    ).length;
    return n > 0
      ? `${n} finding${n !== 1 ? "s" : ""} indicate undocumented decision rationale.`
      : "Undocumented rationale increases future rediscovery cost.";
  }
  if (/alternative/.test(l)) {
    return "Decisions with no rejected alternatives reduce traceability of the design space.";
  }
  if (/link|incident/.test(l)) {
    return "Unlinked downstream artifacts obscure the causal chain from incident to decision.";
  }
  if (/owner|approver/.test(l)) {
    return "Decisions without a recorded owner create accountability gaps.";
  }
  return "Addresses a documented gap in the reasoning record.";
}

function affectedFor(rec: string, s: GlobalCriticSummary): string[] {
  const l = rec.toLowerCase();
  const findings = (() => {
    if (/rationale/.test(l)) {
      return s.keyFindings.filter(f =>
        /rationale|after the fact/.test(f.toLowerCase()),
      );
    }
    if (/alternative/.test(l)) {
      return s.keyFindings.filter(f => /alternatives/.test(f.toLowerCase()));
    }
    if (/link|incident/.test(l)) {
      return s.keyFindings.filter(f =>
        /downstream|trace back/.test(f.toLowerCase()),
      );
    }
    return [];
  })();
  const ids = findings.flatMap(extractIdsFromFinding);
  return [...new Set(ids)];
}

export function buildRemediationPlan(s: GlobalCriticSummary): RemediationItem[] {
  if (s.totalArtifacts === 0) return [];

  const items: RemediationItem[] = [];

  // P1 — direct audit of high-risk artifacts (not covered by any recommendation)
  if (s.highRiskArtifacts.length > 0) {
    items.push({
      priority: "P1",
      action: "Conduct targeted audit to recover lost context for high-risk artifacts.",
      rationale:
        "These artifacts carry gaps most likely to cause costly rediscovery work.",
      affected: s.highRiskArtifacts,
      effort: "HIGH",
    });
  }

  // One item per recommendation from GlobalCriticSummary
  s.recommendations.forEach(rec => {
    const priority = priorityOf(rec);
    items.push({
      priority,
      action: rec,
      rationale: rationaleFor(rec, s),
      affected: affectedFor(rec, s),
      effort: effortOf(priority),
    });
  });

  // Stable sort: P1 → P2 → P3; within the same tier, insertion order is preserved
  const tier: Record<RemediationPriority, number> = { P1: 0, P2: 1, P3: 2 };
  items.sort((a, b) => tier[a.priority] - tier[b.priority]);

  return items;
}
