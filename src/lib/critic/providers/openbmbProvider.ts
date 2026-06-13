// ─── AI CRITIC · OPENBMB / HUGGINGFACE PROVIDER ────────────────────────────────
//
// Server-only module — never import from client components.
//
// Two CriticProvider factories:
//   makeOpenbmbProvider(apiKey)  — OpenBMB's own OpenAI-compatible API
//   makeHfProvider(token)        — HuggingFace Inference API (same model)
//
// Both use the same MiniCPM4-8B chat-completions payload and time out after
// TIMEOUT_MS, propagating errors so the caller can fall back to the mock.

import type { CriticProvider } from "../types";

const TIMEOUT_MS = 20_000;

// Slug of the target model on HuggingFace.  Override with OPENBMB_MODEL if
// the published slug changes (e.g. "openbmb/MiniCPM4.1-8B").
const MODEL = process.env.OPENBMB_MODEL ?? "openbmb/MiniCPM4-8B";

// OpenBMB's own OpenAI-compatible endpoint.
// Override base URL with OPENBMB_BASE_URL if their hosting address changes.
const OPENBMB_BASE =
  (process.env.OPENBMB_BASE_URL ?? "https://api.openbmb.cn").replace(/\/$/, "") + "/v1";

// HuggingFace Inference API — model-scoped OpenAI-compatible path.
const HF_BASE = `https://api-inference.huggingface.co/models/${MODEL}/v1`;

async function chatCompletion(
  baseUrl: string,
  authHeader: string,
  prompt: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("empty response from model");
  return text;
}

/** CriticProvider backed by OpenBMB's own API (requires OPENBMB_API_KEY). */
export function makeOpenbmbProvider(apiKey: string): CriticProvider {
  return (prompt: string) => chatCompletion(OPENBMB_BASE, `Bearer ${apiKey}`, prompt);
}

/** CriticProvider backed by HuggingFace Inference API (requires HF_TOKEN). */
export function makeHfProvider(token: string): CriticProvider {
  return (prompt: string) => chatCompletion(HF_BASE, `Bearer ${token}`, prompt);
}
