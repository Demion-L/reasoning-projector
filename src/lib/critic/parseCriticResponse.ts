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

/**
 * Strip all <think>…</think> blocks from model output.
 * MiniCPM4.1-8B emits chain-of-thought inside these tags before the answer.
 * Returns the text that comes after the last </think> tag (or the full text
 * if no think blocks are present).
 */
function stripThinkBlocks(raw: string): { after: string; full: string } {
  const closeTag = "</think>";
  const lastClose = raw.lastIndexOf(closeTag);
  if (lastClose === -1) return { after: raw, full: raw };
  const after = raw.slice(lastClose + closeTag.length).trim();
  return { after, full: raw };
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
  if (!raw || typeof raw !== "string") {
    console.error("[critic:parse] ✗ raw input is empty or not a string");
    return { ...EMPTY_REPORT };
  }

  // Prefer content after </think> — MiniCPM4.1-8B emits chain-of-thought inside
  // <think>…</think> before the actual answer JSON. Fall back to full raw text
  // only if the post-think slice contains no parseable JSON block.
  const { after, full } = stripThinkBlocks(raw);
  const hasThink = after !== full;

  let block = extractJsonBlock(after);
  if (!block && hasThink) {
    console.warn("[critic:parse] no JSON in post-think content — retrying on full raw");
    block = extractJsonBlock(full);
  }

  if (!block) {
    console.error("[critic:parse] ✗ no JSON block found in raw content");
    console.error(`[critic:parse] raw (first 500 chars): ${raw.slice(0, 500)}`);
    return { ...EMPTY_REPORT };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(block) as Record<string, unknown>;
  } catch (err) {
    console.error(`[critic:parse] ✗ JSON.parse failed: ${err}`);
    console.error(`[critic:parse] block: ${block.slice(0, 500)}`);
    return { ...EMPTY_REPORT };
  }

  console.log("[critic:parse] parsed keys:", Object.keys(parsed).join(", "));

  const missingContext    = toStringArray(parsed.missingContext);
  const weakAssumptions   = toStringArray(parsed.weakAssumptions);
  const suggestedArtifacts = toStringArray(parsed.suggestedArtifacts);
  const confidence        = toConfidence(parsed.confidence);
  const debtRisk          = toDebtRisk(parsed.debtRisk);

  if (missingContext.length === 0)     console.warn(`[critic:parse] missingContext empty    — raw field: ${JSON.stringify(parsed.missingContext)}`);
  if (weakAssumptions.length === 0)    console.warn(`[critic:parse] weakAssumptions empty   — raw field: ${JSON.stringify(parsed.weakAssumptions)}`);
  if (suggestedArtifacts.length === 0) console.warn(`[critic:parse] suggestedArtifacts empty — raw field: ${JSON.stringify(parsed.suggestedArtifacts)}`);
  if (confidence === 0)                console.warn(`[critic:parse] confidence is 0          — raw field: ${JSON.stringify(parsed.confidence)}`);

  return { missingContext, weakAssumptions, debtRisk, suggestedArtifacts, confidence };
}
