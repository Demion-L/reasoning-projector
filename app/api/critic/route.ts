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
import type { CriticInput, CriticReport, CriticNode } from "@/src/lib/critic";

export const runtime = "nodejs";

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by a stable serialisation of the critic input so re-clicking the same
// node in a demo returns identical output without another 40-second model call.
// Only successful OpenBMB responses are cached; fallback deterministic results
// are not, so a transient failure doesn't poison future live calls.

const _cache = new Map<string, CriticReport>();

function _nodeCanonical(n: CriticNode) {
  return {
    id: n.id, tag: n.tag, who: n.who, when: n.when, what: n.what,
    signals: [...n.signals].sort(),
    alts:    [...n.alts].sort(),
    lost:    n.lost,
  };
}

function _cacheKey(input: CriticInput): string {
  return JSON.stringify({
    node:   _nodeCanonical(input.node),
    linked: [...input.linked]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(_nodeCanonical),
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let input: CriticInput;
  try {
    input = (await req.json()) as CriticInput;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const apiKey = process.env.OPENBMB_API_KEY;

  if (apiKey) {
    const key = _cacheKey(input);
    const cached = _cache.get(key);
    if (cached) {
      console.log("[critic] cache hit — returning cached openbmb report");
      return NextResponse.json({ report: cached, source: "openbmb" });
    }

    console.log("[critic] provider selected: openbmb (MiniCPM4.1-8B)");
    const provider = makeOpenbmbProvider(apiKey);
    try {
      const report = await runCritic(input, { provider });
      _cache.set(key, report);
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
