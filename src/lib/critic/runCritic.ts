// ─── AI CRITIC · PIPELINE ENTRYPOINT ───────────────────────────────────────────
//
// runCritic() wires the pipeline together:
//
//     CriticInput → buildCriticPrompt → provider(prompt) → parseCriticResponse
//
// The provider is pluggable. Today it defaults to a MOCK that synthesises a
// plausible response from the input heuristically, so the UI can be wired and
// demoed before any model integration. When OpenBMB (MiniCPM-o / AgentCPM) is
// integrated, supply a real `CriticProvider` and nothing else changes.

import { buildCriticPrompt } from "./buildCriticPrompt";
import { parseCriticResponse } from "./parseCriticResponse";
import type {
  CriticInput,
  CriticProvider,
  CriticReport,
  DebtRisk,
} from "./types";

// ── Mock provider ──────────────────────────────────────────────────────────────
//
// Derives a report from the graph context so each node shows distinct, relevant
// findings. This intentionally mirrors what a model would return: it emits the
// same strict JSON contract that parseCriticResponse expects, exercising the
// full parse path rather than short-circuiting it.

function mockCriticProvider(input: CriticInput): string {
  const { node, linked } = input;

  const missingContext: string[] = [];
  const weakAssumptions: string[] = [];
  const suggestedArtifacts: string[] = [];

  // Reasoning debt explicitly flagged on the node.
  if (node.lost && node.lost.trim().length > 0) {
    missingContext.push(
      `${node.id}: rationale flagged as lost — "${node.lost.trim()}"`,
    );
    suggestedArtifacts.push(
      `ADR section for ${node.id} capturing the rejected/forgotten rationale`,
    );
  }

  // No alternatives recorded → the decision looks unchallenged.
  if (node.alts.length === 0) {
    weakAssumptions.push(
      `${node.id} records no rejected alternatives — assumes the chosen path was the only option`,
    );
    suggestedArtifacts.push(`Trade-off note listing alternatives weighed for ${node.id}`);
  }

  // Decisions with no supporting signals are unsubstantiated.
  if (node.signals.length === 0) {
    missingContext.push(`${node.id} cites no upstream signals — provenance is unclear`);
  } else if (linked.length < node.signals.length) {
    missingContext.push(
      `${node.id} references signals that resolve to no known artifact (${node.signals.length} cited, ${linked.length} linked)`,
    );
  }

  // Authorship / dating gaps.
  if (!node.who || !node.who.trim()) {
    missingContext.push(`${node.id} has no recorded author`);
  }
  if (!node.when || !node.when.trim()) {
    missingContext.push(`${node.id} has no recorded date`);
  }

  // Decision-specific scrutiny.
  if (node.tag === "decision") {
    weakAssumptions.push(
      `${node.id}: assumes linked incidents share one root cause — not independently verified`,
    );
    suggestedArtifacts.push(`Postmortem cross-referencing the linked incidents`);
  }

  // Debt risk scales with how many gaps surfaced.
  const gapScore =
    (node.lost ? 2 : 0) +
    (node.alts.length === 0 ? 1 : 0) +
    (node.signals.length === 0 ? 1 : 0) +
    missingContext.length;
  const debtRisk: DebtRisk = gapScore >= 4 ? "HIGH" : gapScore >= 2 ? "MEDIUM" : "LOW";

  // Confidence drops as the picture gets thinner.
  const evidence = node.signals.length + linked.length + node.alts.length;
  const confidence = Math.min(0.95, 0.45 + evidence * 0.1);

  return JSON.stringify({
    missingContext,
    weakAssumptions,
    debtRisk,
    suggestedArtifacts,
    confidence: Number(confidence.toFixed(2)),
  });
}

/** Default provider used until a real model backend is supplied. */
export const defaultCriticProvider: CriticProvider = (prompt: string) => {
  // The mock derives its answer from the embedded context rather than the prompt
  // string, but it is invoked through the same provider seam a real model uses.
  void prompt;
  return Promise.resolve("");
};

export interface RunCriticOptions {
  /** Override the model backend. Defaults to the built-in mock. */
  provider?: CriticProvider;
}

/**
 * Run the full critic pipeline for a node + its linked context.
 *
 * Returns a validated CriticReport. With no provider supplied, a deterministic
 * mock is used so the UI behaves end-to-end before model integration.
 */
export async function runCritic(
  input: CriticInput,
  options: RunCriticOptions = {},
): Promise<CriticReport> {
  const prompt = buildCriticPrompt(input);

  // When a real provider is supplied, use it. Otherwise synthesise the mock
  // response directly from the input so the demo is meaningful per-node.
  const raw = options.provider
    ? await options.provider(prompt)
    : mockCriticProvider(input);

  return parseCriticResponse(raw);
}
