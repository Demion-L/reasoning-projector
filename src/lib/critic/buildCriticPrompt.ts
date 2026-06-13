// ─── AI CRITIC · PROMPT BUILDER ────────────────────────────────────────────────
//
// Converts the graph context (focus node + linked nodes) into a structured
// reasoning-review prompt. The prompt is model-agnostic: it states the role,
// the review dimensions, the input context, and a strict output contract that
// parseCriticResponse can consume.

import type { CriticInput, CriticNode } from "./types";

function describeNode(n: CriticNode, role: "FOCUS" | "LINKED"): string {
  const lines: string[] = [];
  lines.push(`[${role}] ${n.id}  (${n.tag})`);
  lines.push(`  what:    ${n.what || "—"}`);
  lines.push(`  who:     ${n.who || "—"}`);
  lines.push(`  when:    ${n.when || "—"}`);
  lines.push(`  signals: ${n.signals.length ? n.signals.join(", ") : "—"}`);
  lines.push(`  alts:    ${n.alts.length ? n.alts.join(" | ") : "none recorded"}`);
  lines.push(`  lost:    ${n.lost ? n.lost : "none flagged"}`);
  return lines.join("\n");
}

/**
 * Build the reasoning-review prompt for a node and its linked context.
 *
 * The output contract is a strict JSON object so the response can be parsed
 * deterministically regardless of the backing model.
 */
export function buildCriticPrompt(input: CriticInput): string {
  const { node, linked } = input;

  const context = [
    describeNode(node, "FOCUS"),
    ...linked.map((n) => describeNode(n, "LINKED")),
  ].join("\n\n");

  return [
    "You are a REASONING CRITIC reviewing a single decision-graph artifact.",
    "Your job is to find what is MISSING or WEAK in the captured reasoning —",
    "not to restate it. Be specific and reference the artifacts by id.",
    "",
    "Review along these dimensions:",
    "  1. MISSING CONTEXT      — facts, constraints, or rationale a future reader",
    "                            would need but cannot recover from these artifacts.",
    "  2. WEAK ASSUMPTIONS     — claims taken for granted without evidence or",
    "                            unconsidered alternatives.",
    "  3. DEBT RISK            — how much reasoning debt this node carries:",
    "                            LOW | MEDIUM | HIGH.",
    "  4. SUGGESTED ARTIFACTS  — concrete documents/records that would close the",
    "                            gaps (e.g. an ADR section, a postmortem, a test).",
    "  5. CONFIDENCE           — your confidence in this review, 0.0 to 1.0.",
    "",
    "─── GRAPH CONTEXT ──────────────────────────────────────────────",
    context,
    "────────────────────────────────────────────────────────────────",
    "",
    "Respond with ONLY a JSON object, no prose, matching exactly:",
    "{",
    '  "missingContext": string[],',
    '  "weakAssumptions": string[],',
    '  "debtRisk": "LOW" | "MEDIUM" | "HIGH",',
    '  "suggestedArtifacts": string[],',
    '  "confidence": number',
    "}",
  ].join("\n");
}
