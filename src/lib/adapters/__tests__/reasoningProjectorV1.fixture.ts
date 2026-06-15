// Fixture: verify adaptReasoningProjectorV1 converts a minimal v1 document.
// Run with:  npx tsx src/lib/adapters/__tests__/reasoningProjectorV1.fixture.ts

import { adaptReasoningProjectorV1 } from "../reasoningProjectorV1";

const MPT_548_SAMPLE = {
  $schema: "reasoning-projector/v1",
  epic: "MPT-548 — Memory Pressure Tuning",
  incident: {
    id: "INC-2024-0312",
    title: "OOM kills on inference workers under burst load",
    detected_at: "2024-03-12",
    root_cause: "",                       // missing — should surface in lost
    related_findings: ["FIND-001", "FIND-002"],
  },
  investigations: [
    {
      investigation_id: "INV-001",
      title: "Heap profile — batch size vs. RSS correlation",
      conducted_by: "Oleksiy M.",
      generated_at: "2024-03-13",
      finding: "RSS grows linearly with batch size; no cap enforced.",
    },
    {
      investigation_id: "INV-002",
      title: "GC pressure under concurrent requests",
      conducted_by: "Sasha R.",
      generated_at: "2024-03-14",
      // no finding — should surface in lost
    },
  ],
  findings: [
    {
      finding_id: "FIND-001",
      title: "Batch size defaults to 512 — no worker-level guard",
      raised_by: "Oleksiy M.",
      generated_at: "2024-03-13",
      description: "512-sample batches cause 18 GB RSS on 16 GB nodes.",
      resolution: "Cap batch size to 128 via env BATCH_MAX.",
      pr: "PR-4421",
    },
    {
      finding_id: "FIND-002",
      title: "KV-cache eviction policy not tuned for burst",
      raised_by: "Sasha R.",
      generated_at: "2024-03-14",
      description: "LRU eviction races against incoming requests.",
      // no resolution — description should appear in lost
    },
  ],
  decision_graph: [
    {
      decision_id: "DEC-001",
      title: "Cap batch size at 128 and enable adaptive KV-cache TTL",
      generated_at: "2024-03-15",
      selected_rationale: "Reduces peak RSS by 65 % without throughput regression.",
      alternatives: [
        { option: "Scale-up to 32 GB nodes", verdict: "rejected", reason: "3× cost increase" },
        { option: "Disable KV-cache entirely", verdict: "rejected", reason: "40 % latency spike" },
      ],
      related_findings:      ["FIND-001", "FIND-002"],
      related_investigations: ["INV-001"],
    },
  ],
};

// ─── Run ──────────────────────────────────────────────────────────────────────

const nodes = adaptReasoningProjectorV1(MPT_548_SAMPLE as Record<string, unknown>);

console.log("=== reasoningProjectorV1 fixture ===");
console.log(`Nodes produced: ${nodes.length}`);
nodes.forEach(n => console.log(`  [${n.tag.padEnd(13)}] ${n.id}  lost=${JSON.stringify(n.lost || "(none)")}`));

// Assertions
let pass = true;

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); pass = false; }
}

assert(nodes.length > 0,         "should produce at least one node");

const tags = nodes.map(n => n.tag);
assert(tags.includes("incident"),      "should include incident node");
assert(tags.includes("investigation"), "should include investigation nodes");
assert(tags.includes("finding"),       "should include finding nodes");
assert(tags.includes("decision"),      "should include decision node");

const incident = nodes.find(n => n.tag === "incident")!;
assert(incident.id === "INC-2024-0312",              "incident id");
assert(incident.lost === "Root cause missing",        "incident lost — root_cause absent");
assert(incident.signals.includes("FIND-001"),         "incident signals contain FIND-001");

const inv1 = nodes.find(n => n.id === "INV-001")!;
assert(inv1.lost === "",                                           "INV-001 has finding — lost empty");
const inv2 = nodes.find(n => n.id === "INV-002")!;
assert(inv2.lost !== "",                                           "INV-002 missing finding — lost non-empty");

const find1 = nodes.find(n => n.id === "FIND-001")!;
assert(find1.lost === "",                                          "FIND-001 has resolution — lost empty");
assert(find1.signals.includes("PR-4421"),                         "FIND-001 signals include PR");
const find2 = nodes.find(n => n.id === "FIND-002")!;
assert(find2.lost !== "",                                          "FIND-002 missing resolution — lost non-empty");

const dec = nodes.find(n => n.tag === "decision")!;
assert(dec.id === "DEC-001",                                      "decision id");
assert(dec.lost === "",                                            "decision has rationale — lost empty");
assert(dec.alts.length === 2,                                     "decision has 2 alternatives");
assert(dec.signals.includes("FIND-001"),                          "decision signals include FIND-001");
assert(dec.signals.includes("INV-001"),                           "decision signals include INV-001");

console.log(pass ? "\nAll assertions passed." : "\nSome assertions FAILED.");
process.exit(pass ? 0 : 1);
