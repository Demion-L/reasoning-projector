---
title: Reasoning Projector
emoji: 🧠
colorFrom: indigo
colorTo: blue
sdk: gradio
app_file: app.py
pinned: false
short_description: Reconstructs why software decisions exist and detects Reasoning Debt
---

# Reasoning Projector

**Reconstructs why software decisions exist — and detects Reasoning Debt.**

Every engineering decision carries invisible context: *who* made the call and *why*,
which alternatives were considered and rejected, and what rationale was never written
down. Over time this context evaporates. Reasoning Projector makes it visible by
replaying the signal trail from incidents → decision → ADR, and surfaces the gaps
that no API can recover.

---

## Running locally

### Option A — two terminals (recommended for development)

**Terminal 1 — Next.js app:**
```bash
npm install
npm run build
npm run start        # serves on http://localhost:3000
```

**Terminal 2 — Gradio wrapper:**
```bash
pip install -r requirements.txt
START_NEXTJS=0 python app.py   # Gradio on http://localhost:7860
```

Open `http://localhost:7860` — Gradio embeds the Next.js app via iframe.

---

### Option B — single command

Let `app.py` build and start Next.js automatically:

```bash
npm install          # install Node dependencies once
pip install -r requirements.txt

python app.py        # builds Next.js if needed, starts both processes
```

`app.py` prints `[next]` prefixed logs from Next.js alongside its own output.
The first run takes ~60 s while Next.js builds.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `START_NEXTJS` | `1` | Set to `0` to skip starting Next.js (use when running it separately) |
| `NEXTJS_PORT` | `3000` | Port Next.js listens on |
| `NEXTJS_URL` | `http://localhost:3000` | URL the Gradio iframe points to. Override for external deployments. |
| `GRADIO_PORT` | `7860` | Port Gradio listens on |

---

## Refreshing nodes data

Node data lives in `src/data/nodes.json`. To pull fresh data from GitHub:

```bash
GITHUB_TOKEN=ghp_xxx GITHUB_OWNER=myorg GITHUB_REPO=myrepo \
  node scripts/fetch-memory.mjs
```

Without env vars the script writes the built-in mock dataset.

---

## Project structure

```
.
├── app/                  # Next.js App Router
│   └── page.tsx          # MemoryReplay component (main UI)
├── src/
│   └── data/
│       ├── nodes.json        # live node data (editable / auto-generated)
│       └── nodes.schema.json # JSON schema for node validation
├── scripts/
│   └── fetch-memory.mjs  # fetches nodes from GitHub / Linear
├── app.py                # Gradio wrapper (HF Spaces entry point)
├── requirements.txt      # Python dependencies
├── packages.txt          # apt packages installed on HF Spaces (nodejs, npm)
└── README.md             # this file + HF Space metadata
```
