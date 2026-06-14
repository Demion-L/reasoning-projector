---

title: Reasoning Projector
emoji: 🧠
colorFrom: indigo
colorTo: blue
sdk: gradio
app_file: app.py
pinned: false
short_description: Reconstruct software decisions, detect Reasoning Debt, and generate remediation plans.
license: mit
---
# 🧠 Reasoning Projector

![OpenBMB](https://img.shields.io/badge/OpenBMB-Powered-blue)
![MiniCPM4.1-8B](https://img.shields.io/badge/MiniCPM4.1--8B-AI%20Critic-green)
![BuildSmall2026](https://img.shields.io/badge/Build%20Small-2026-orange)

> Technical Debt is visible.
> Reasoning Debt is not.

Reasoning Projector is a Decision Intelligence System that reconstructs lost engineering rationale from connected artifacts such as incidents, ADRs, investigations, fixes, pull requests, and architectural decisions.

Instead of asking:

> What does the code do?

It asks:

> Why does this decision exist?

---

# 🚀 Build Small 2026 Submission

### Track Tags

* #OpenBMB
* #Reasoning
* #DeveloperTools
* #KnowledgeManagement
* #DecisionIntelligence
* #AIEngineering

---

# Problem

Engineering teams preserve code.

They rarely preserve reasoning.

Over time organizations lose:

* Why a decision was made
* Which alternatives were rejected
* Who approved the change
* Which incidents influenced the outcome
* What context existed during discussions

The code survives.

The reasoning doesn't.

This creates **Reasoning Debt**.

---

# Solution

Reasoning Projector reconstructs decision history from engineering artifacts and identifies missing rationale before it becomes organizational debt.

The system:

1. Loads engineering artifacts
2. Builds a reasoning graph
3. Reconstructs historical context
4. Detects reasoning debt
5. Generates audit reports
6. Produces remediation plans

---

# OpenBMB Integration

### Model

**MiniCPM4.1-8B**

### Role

AI Critic Engine

The model reviews reconstructed reasoning chains and identifies:

* Missing Context
* Weak Assumptions
* Missing Evidence
* Undocumented Alternatives
* Reasoning Debt Risk
* Suggested Missing Artifacts

Architecture:

Artifacts
→ Reasoning Graph
→ Reconstruction Engine
→ MiniCPM4.1-8B Critic
→ Audit Report

The deterministic engine reconstructs the graph first.

MiniCPM4.1-8B then performs reasoning review and critique.

---

# Key Features

### Artifact Graph

Visualizes relationships between:

* Incidents
* Decisions
* ADRs
* Fixes
* Pull Requests
* Investigations

### Reconstructed Memory

Recovers lost context from artifact chains.

### AI Critic Reports

Per-artifact analysis:

* Missing Context
* Weak Assumptions
* Debt Risk
* Suggested Artifacts
* Confidence Score

### Global Critic Summary

Dataset-level reasoning audit.

### Executive Summary

Management-ready overview of reasoning health.

### Remediation Plan

Prioritized actions:

* P1 Critical
* P2 Important
* P3 Governance

### Markdown Audit Export

Generates a complete reasoning audit report.

---

# Example Workflow

Upload Dataset
↓
Build Reasoning Graph
↓
Reconstruct Decision History
↓
Detect Reasoning Debt
↓
Generate Executive Summary
↓
Generate Remediation Plan
↓
Export Audit Report

---

# Example Findings

* Architectural decisions without documented rationale
* ADRs written after implementation
* Incidents linked to undocumented decisions
* Missing rejected alternatives
* Missing ownership trails

---

# Demo

Hugging Face Space:
[SPACE_LINK]

Demo Video:
[YOUTUBE_LINK]

Social Post:
https://x.com/Demion_L/status/2063671465271312628

GitHub Repository:
https://github.com/Demion-L/reasoning-projector

---

# Running Locally

## Next.js

```bash
npm install
npm run dev
```

## Gradio Wrapper

```bash
pip install -r requirements.txt
python app.py
```

---

# Vision

Organizations lose knowledge every day.

Reasoning Projector helps teams recover, preserve, and audit the reasoning behind important decisions before it disappears.

The long-term goal is to make organizational reasoning as observable as application telemetry.
