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

const TIMEOUT_MS = 60_000;

const MODEL =
  process.env.OPENBMB_MODEL ?? "MiniCPM4.1-8B";

const OPENBMB_BASE =
  (process.env.OPENBMB_BASE_URL ?? "http://35.203.155.71:8001").replace(/\/$/, "") + "/v1";

async function chatCompletion(apiKey: string, prompt: string): Promise<string> {
  const endpoint = `${OPENBMB_BASE}/chat/completions`;
  console.log(`[critic:openbmb] → ${endpoint}  model=${MODEL}`);
  const t0 = Date.now();

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    console.error(`[critic:openbmb] ✗ abort fired after ${TIMEOUT_MS}ms — aborting fetch`);
    ctrl.abort();
  }, TIMEOUT_MS);

  const reqBody = JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3072,
    temperature: 0,
    top_p: 1,
    seed: 42,
  });
  console.log(`[critic:openbmb] request body: ${reqBody.slice(0, 500)}`);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: reqBody,
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    const name = err instanceof Error ? err.name : String(err);
    const msg  = err instanceof Error ? err.message : String(err);
    console.error(`[critic:openbmb] ✗ fetch threw after ${elapsed}ms — ${name}: ${msg}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const elapsed = Date.now() - t0;
  console.log(`[critic:openbmb] ← HTTP ${res.status} in ${elapsed}ms`);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[critic:openbmb] ✗ HTTP ${res.status} body: ${body.slice(0, 500)}`);
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  const rawJson = await res.text();
  console.log(`[critic:openbmb] response body: ${rawJson.slice(0, 500)}`);

  let json: { choices?: { message?: { content?: string } }[] };
  try {
    json = JSON.parse(rawJson);
  } catch (err) {
    console.error(`[critic:openbmb] ✗ JSON parse failed: ${rawJson.slice(0, 200)}`);
    throw new Error(`JSON parse error: ${rawJson.slice(0, 200)}`);
  }

  const text = json.choices?.[0]?.message?.content ?? "";

  if (!text) {
    console.error(`[critic:openbmb] ✗ empty content in response after ${elapsed}ms`);
    throw new Error("empty response from model");
  }

  console.log(`[critic:openbmb] ✓ ${elapsed}ms  model=${MODEL}  chars=${text.length}`);
  console.log(`[critic:openbmb] assistant content:\n${text}`);
  return text;
}

/** CriticProvider backed by the OpenBMB chat-completions endpoint. */
export function makeOpenbmbProvider(apiKey: string): CriticProvider {
  return (prompt: string) => chatCompletion(apiKey, prompt);
}
