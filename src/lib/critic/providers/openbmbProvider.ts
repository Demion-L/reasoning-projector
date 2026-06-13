// ─── AI CRITIC · OPENBMB PROVIDER ────────────────────────────────────────────
//
// Server-only module — never import from client components.
//
// Wraps the OpenBMB OpenAI-compatible chat-completions endpoint.
// Base URL and model are overridable via env vars so the deployment
// target can change without a code edit.
//
// Env vars (set in .env.local):
//   OPENBMB_API_KEY   — required to enable the live provider
//   OPENBMB_BASE_URL  — host only, e.g. http://35.203.155.71:8001
//                       defaults to the Zhong-hosted endpoint
//   OPENBMB_MODEL     — model name sent in the request body
//                       defaults to MiniCPM4.1-8B

import type { CriticProvider } from "../types";

const TIMEOUT_MS = 20_000;

const MODEL =
  process.env.OPENBMB_MODEL ?? "MiniCPM4.1-8B";

const OPENBMB_BASE =
  (process.env.OPENBMB_BASE_URL ?? "http://35.203.155.71:8001").replace(/\/$/, "") + "/v1";

async function chatCompletion(apiKey: string, prompt: string): Promise<string> {
  const endpoint = `${OPENBMB_BASE}/chat/completions`;
  console.log(`[critic:openbmb] → ${endpoint}  model=${MODEL}`);
  const t0 = Date.now();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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

  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[critic:openbmb] ✗ HTTP ${res.status} in ${elapsed}ms — ${body.slice(0, 200)}`);
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";

  if (!text) {
    console.error(`[critic:openbmb] ✗ empty response in ${elapsed}ms`);
    throw new Error("empty response from model");
  }

  console.log(`[critic:openbmb] ✓ ${elapsed}ms  model=${MODEL}  chars=${text.length}`);
  return text;
}

/** CriticProvider backed by the OpenBMB chat-completions endpoint. */
export function makeOpenbmbProvider(apiKey: string): CriticProvider {
  return (prompt: string) => chatCompletion(apiKey, prompt);
}
