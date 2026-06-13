// ─── AI CRITIC · EXECUTIVE SUMMARY ──────────────────────────────────────────
//
// buildExecutiveSummary() converts a GlobalCriticSummary into a short,
// human-readable verdict suitable for a report header or a UI banner.
//
// Fully DETERMINISTIC — same input always yields the same output.
// No model, no randomness, no I/O.

import type {
  GlobalCriticSummary,
  ExecutiveSummary,
  HealthStatus,
  ExecutiveRiskLevel,
} from "./types";

export function buildExecutiveSummary(s: GlobalCriticSummary): ExecutiveSummary {
  const confidencePct = Math.round(s.overallConfidence * 100);
  const debtRatio = s.totalArtifacts > 0 ? s.totalDebtMarkers / s.totalArtifacts : 0;

  const riskLevel: ExecutiveRiskLevel =
    s.highRiskArtifacts.length > 0 || debtRatio > 0.5 ? "HIGH" :
    s.totalDebtMarkers > 0 || s.keyFindings.length > 0  ? "MEDIUM" : "LOW";

  const status: HealthStatus =
    riskLevel === "HIGH" && confidencePct < 55 ? "CRITICAL" :
    riskLevel !== "LOW"  || confidencePct < 70  ? "DEGRADED" : "NOMINAL";

  const headline: Record<HealthStatus, string> = {
    CRITICAL: "Critical reasoning gaps detected — immediate remediation required.",
    DEGRADED: "Partial documentation gaps identified — remediation recommended.",
    NOMINAL:  "Reasoning record is adequately documented — no critical gaps found.",
  };

  const body: string[] = [];

  // Scope sentence (always present)
  body.push(
    `Dataset contains ${s.totalArtifacts} artifact${s.totalArtifacts !== 1 ? "s" : ""} ` +
    `including ${s.totalDecisions} decision${s.totalDecisions !== 1 ? "s" : ""}.`,
  );

  // Debt sentence
  if (s.totalDebtMarkers > 0) {
    const pct = Math.round(debtRatio * 100);
    body.push(
      `${s.totalDebtMarkers} artifact${s.totalDebtMarkers !== 1 ? "s carry" : " carries"} ` +
      `reasoning debt markers (${pct}% of dataset).`,
    );
  }

  // High-risk call-out
  if (s.highRiskArtifacts.length > 0) {
    body.push(
      `High-risk artifact${s.highRiskArtifacts.length !== 1 ? "s" : ""} requiring ` +
      `immediate attention: ${s.highRiskArtifacts.join(", ")}.`,
    );
  }

  // Confidence verdict
  if (confidencePct < 55) {
    body.push(
      `Documentation confidence of ${confidencePct}% indicates significant knowledge gaps ` +
      `that may increase future maintenance cost.`,
    );
  } else if (confidencePct < 75) {
    body.push(
      `Documentation confidence of ${confidencePct}% indicates a partially maintained ` +
      `reasoning record with recoverable gaps.`,
    );
  } else {
    body.push(
      `Documentation confidence of ${confidencePct}% indicates a well-maintained ` +
      `reasoning record.`,
    );
  }

  return { status, riskLevel, headline: headline[status], body, confidencePct };
}
