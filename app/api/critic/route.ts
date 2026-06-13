// ─── API · POST /api/critic ────────────────────────────────────────────────────
//
// Request:  { node: CriticNode, linked: CriticNode[] }
// Response: { report: CriticReport, source: "mocked" | "openbmb" }
//
// Provider resolution order (first match wins):
//   1. OPENBMB_API_KEY  → OpenBMB's own API
//   2. HF_TOKEN         → HuggingFace Inference API
//   3. (none)           → deterministic mock
//
// If the provider call fails for any reason (timeout, HTTP error, bad JSON),
// the route falls back to the mock so the UI always gets a valid response.
// The API key never leaves the server.

import { NextRequest, NextResponse } from "next/server";
import { runCritic } from "@/src/lib/critic";
import {
  makeOpenbmbProvider,
  makeHfProvider,
} from "@/src/lib/critic/providers/openbmbProvider";
import type { CriticInput } from "@/src/lib/critic";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let input: CriticInput;
  try {
    input = (await req.json()) as CriticInput;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const openbmbKey = process.env.OPENBMB_API_KEY;
  const hfToken = process.env.HF_TOKEN;

  if (openbmbKey || hfToken) {
    const provider = openbmbKey
      ? makeOpenbmbProvider(openbmbKey)
      : makeHfProvider(hfToken!);
    try {
      const report = await runCritic(input, { provider });
      return NextResponse.json({ report, source: "openbmb" });
    } catch {
      // Provider failed — fall through to mock.
    }
  }

  const report = await runCritic(input);
  return NextResponse.json({ report, source: "mocked" });
}
