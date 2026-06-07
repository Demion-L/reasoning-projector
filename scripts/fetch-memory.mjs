#!/usr/bin/env node
/**
 * fetch-memory.mjs
 * ─────────────────
 * Собирает данные из любого источника и выдаёт nodes.json
 * для MemoryReplay (app/page.tsx).
 *
 * Запуск:
 *   node scripts/fetch-memory.mjs
 *   node scripts/fetch-memory.mjs --out ./src/data/nodes.json
 *
 * Требования: Node 18+ (встроенный fetch)
 */

import { writeFileSync } from "fs";
import { parseArgs }     from "util";

const { values: args } = parseArgs({
  options: { out: { type: "string", default: "./src/data/nodes.json" } },
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  github: {
    token: process.env.GITHUB_TOKEN ?? "",
    owner: process.env.GITHUB_OWNER ?? "",
    repo:  process.env.GITHUB_REPO  ?? "",
    decisionLabels: ["adr", "decision", "architecture"],
    signalLabels:   ["bug", "fix", "incident", "invoice"],
  },

  layout: {
    autoLayout: true,
    nodeW: 120,
    nodeH: 44,
    colGap: 160,
    rowGap: 80,
    paddingX: 60,
    paddingY: 40,
  },
};

// ─── FETCHERS ─────────────────────────────────────────────────────────────────

async function fetchGitHubIssues() {
  const { token, owner, repo, decisionLabels, signalLabels } = CONFIG.github;

  if (!token || !owner || !repo) {
    console.warn("[github] GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO не заданы — используем mock");
    return MOCK_DATA;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const issues = await res.json();

  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`,
    { headers }
  );
  const prs = prRes.ok ? await prRes.json() : [];

  return mapGitHubToNodes([...issues, ...prs], decisionLabels, signalLabels);
}

function mapGitHubToNodes(items, decisionLabels, signalLabels) {
  return items.map(item => {
    const labels = (item.labels ?? []).map(l => l.name);
    const isPR   = !!item.pull_request;

    let tag = isPR ? "pr" : "issue";
    if (labels.some(l => decisionLabels.includes(l))) tag = "decision";
    if (labels.some(l => l === "adr"))                tag = "adr";
    if (labels.some(l => l === "bug"))                tag = "bug";
    if (labels.some(l => l === "fix"))                tag = "fix";

    const body    = item.body ?? "";
    const signals = [...body.matchAll(/#(\d+)/g)].map(m => `#${m[1]}`);

    const lostMatch = body.match(/##\s*(alternatives?|rejected|lost context)[^\n]*\n([\s\S]*?)(\n##|$)/i);
    const lost = lostMatch ? lostMatch[2].trim().slice(0, 200) : "";

    const altsMatch = body.match(/##\s*alternatives?[^\n]*\n([\s\S]*?)(\n##|$)/i);
    const alts = altsMatch
      ? altsMatch[1].split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
      : [];

    return {
      id:      `${isPR ? "PR" : "#"}${item.number}`,
      tag,
      who:     item.user?.login ?? "unknown",
      when:    item.created_at?.slice(0, 10) ?? "",
      what:    item.title ?? "",
      signals: [...new Set(signals)],
      alts,
      lost,
      _url:    item.html_url,
      _state:  item.state,
      _labels: labels,
    };
  });
}

// ─── AUTO LAYOUT ──────────────────────────────────────────────────────────────

function autoLayout(nodes) {
  const { nodeW, nodeH, colGap, rowGap, paddingX, paddingY } = CONFIG.layout;

  const cols = {
    signal:   nodes.filter(n => ["bug","fix","issue","invoice","pr"].includes(n.tag)),
    decision: nodes.filter(n => n.tag === "decision"),
    adr:      nodes.filter(n => n.tag === "adr"),
  };

  const result = [];
  Object.entries(cols).forEach(([, group], colIdx) => {
    group.forEach((node, rowIdx) => {
      result.push({
        ...node,
        x: paddingX + colIdx * (nodeW + colGap),
        y: paddingY + rowIdx * (nodeH + rowGap),
        w: nodeW,
        h: nodeH,
      });
    });
  });

  return result;
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_DATA = [
  {
    id: "FIX-008", tag: "fix",
    who: "mariana-t", when: "2024-03-11",
    what: "Duplicate charge on payment retry",
    signals: ["#14"], alts: [],
    lost: "UI-level fix considered and rejected in standup — not documented anywhere.",
    _url: "", _state: "closed", _labels: ["fix","prod-incident"],
  },
  {
    id: "INV-003", tag: "invoice",
    who: "sales-ops", when: "2024-03-14",
    what: "Invoice sent twice to client via webhook retry",
    signals: ["#8"], alts: ["DB unique constraint on invoice_id"],
    lost: "Constraint option closed only invoices — general problem remained.",
    _url: "", _state: "closed", _labels: ["invoice","client-complaint"],
  },
  {
    id: "BUG-014", tag: "bug",
    who: "pavel-d", when: "2024-03-18",
    what: "Race condition: two workers processing same event",
    signals: ["#8","#3"], alts: ["Redis distributed lock","DB advisory lock"],
    lost: "Redis rejected due to extra dependency. Advisory lock too narrow. Neither in ADR.",
    _url: "", _state: "closed", _labels: ["bug","race-condition"],
  },
  {
    id: "DECISION-001", tag: "decision",
    who: "arch-review", when: "2024-03-20",
    what: "Add idempotency key at API gateway level",
    signals: ["FIX-008","INV-003","BUG-014"],
    alts: ["UI-fix","DB constraint","Redis lock"],
    lost: "TTL discussion (24h vs 7d) resolved verbally — rationale never written down.",
    _url: "", _state: "closed", _labels: ["decision","architecture"],
  },
  {
    id: "ADR-002", tag: "adr",
    who: "pavel-d", when: "2024-03-21",
    what: "ADR: Idempotency via API Gateway — covers /payment /invoice /event-processor",
    signals: ["DECISION-001"],
    alts: [],
    lost: "Rejected alternatives section left empty in ADR. Context lost.",
    _url: "", _state: "closed", _labels: ["adr"],
  },
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[ fetch-memory ] starting...");

  let nodes = await fetchGitHubIssues();
  console.log(`[ fetch-memory ] fetched ${nodes.length} items`);

  if (CONFIG.layout.autoLayout) {
    nodes = autoLayout(nodes);
    console.log("[ fetch-memory ] layout applied");
  }

  const clean = nodes.map(({ _url, _state, _labels, ...rest }) => rest);

  writeFileSync(args.out, JSON.stringify(clean, null, 2), "utf8");
  console.log(`[ fetch-memory ] written → ${args.out}`);
  console.log();
  console.log("Next steps:");
  console.log(`  1. Open ${args.out}`);
  console.log("  2. Fill 'lost' fields manually — no API knows this context");
}

main().catch(err => { console.error(err); process.exit(1); });
