// ─── AI CRITIC · RESPONSE PARSER ───────────────────────────────────────────────
//
// Turns raw model text into a validated CriticReport. Models are unreliable
// narrators: they wrap JSON in prose, fence it in ```json blocks, or omit
// fields. This parser extracts the first JSON object it can find and coerces
// every field into the report contract, never throwing.

import type { CriticReport, DebtRisk } from "./types";

const EMPTY_REPORT: CriticReport = {
  missingContext: [],
  weakAssumptions: [],
  debtRisk: "MEDIUM",
  suggestedArtifacts: [],
  confidence: 0,
};

/** Pull the first balanced `{...}` block out of arbitrary model text. */
function extractJsonBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
    .filter((v) => v.length > 0);
}

function toDebtRisk(value: unknown): DebtRisk {
  const v = String(value ?? "").toUpperCase();
  return v === "LOW" || v === "HIGH" ? v : "MEDIUM";
}

function toConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Parse a raw model response into a CriticReport.
 * Always returns a well-formed report — malformed input yields safe defaults.
 */
export function parseCriticResponse(raw: string): CriticReport {
  if (!raw || typeof raw !== "string") return { ...EMPTY_REPORT };

  const block = extractJsonBlock(raw);
  if (!block) return { ...EMPTY_REPORT };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(block) as Record<string, unknown>;
  } catch {
    return { ...EMPTY_REPORT };
  }

  return {
    missingContext: toStringArray(parsed.missingContext),
    weakAssumptions: toStringArray(parsed.weakAssumptions),
    debtRisk: toDebtRisk(parsed.debtRisk),
    suggestedArtifacts: toStringArray(parsed.suggestedArtifacts),
    confidence: toConfidence(parsed.confidence),
  };
}
