// ─── API · POST /api/critic ────────────────────────────────────────────────────
//
// Request:  { node: CriticNode, linked: CriticNode[] }
// Response: { report: CriticReport, source: "deterministic" | "openbmb" }
//
// Provider resolution:
//   OPENBMB_API_KEY set  → live OpenBMB endpoint (MiniCPM4.1-8B)
//   OPENBMB_API_KEY unset or call fails → deterministic mock fallback
//
// The API key never leaves the server.

import { NextRequest, NextResponse } from "next/server";
import { runCritic } from "@/src/lib/critic";
import { makeOpenbmbProvider } from "@/src/lib/critic/providers/openbmbProvider";
import type { CriticInput } from "@/src/lib/critic";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let input: CriticInput;
  try {
    input = (await req.json()) as CriticInput;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const apiKey = process.env.OPENBMB_API_KEY;

  if (apiKey) {
    console.log("[critic] provider selected: openbmb (MiniCPM4.1-8B)");
    const provider = makeOpenbmbProvider(apiKey);
    try {
      const report = await runCritic(input, { provider });
      return NextResponse.json({ report, source: "openbmb" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[critic] openbmb failed — falling back to deterministic:", reason);
    }
  } else {
    console.log("[critic] OPENBMB_API_KEY not set — using deterministic provider");
  }

  const report = await runCritic(input);
  return NextResponse.json({ report, source: "deterministic" });
}
