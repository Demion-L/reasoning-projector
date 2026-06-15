"""
Gradio landing page for Reasoning Projector (Build Small 2026 submission).

Static page only — no iframe, no subprocess, no proxy, no localhost.
The live application runs on Vercel at https://reasoning-projector.vercel.app/
"""

import gradio as gr

_DESCRIPTION = """\
## What is Reasoning Projector?

Every engineering decision carries invisible context:
*who* made the call and *why*, which alternatives were considered and
rejected, and what rationale was never written down.

Over time this context evaporates. **Reasoning Projector** makes it
visible by replaying the signal trail from incidents → decision → ADR,
and surfaces the gaps — **Reasoning Debt** — that no API can recover.

The AI Critic (MiniCPM4.1-8B via OpenBMB) scores each node for missing
context, weak assumptions, and unresolved debt, then generates a
remediation plan.

> **Live app is demonstrated in the video.**
"""

_LINKS = """\
<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
  <a href="https://reasoning-projector.vercel.app/"
     target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:8px;
            padding:9px 20px;background:#0a0a14;
            color:#4fc3f7;border:1px solid #1a5c7c;border-radius:4px;
            font-family:'SF Mono','Fira Code',monospace;
            text-decoration:none;font-size:13px;letter-spacing:.06em;width:fit-content;">
    ↗ Open Live App
  </a>
  <a href="https://youtu.be/M76tRlVk5nE"
     target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:8px;
            padding:9px 20px;background:#0a0a14;
            color:#ef5350;border:1px solid #7c1a1a;border-radius:4px;
            font-family:'SF Mono','Fira Code',monospace;
            text-decoration:none;font-size:13px;letter-spacing:.06em;width:fit-content;">
    ▶ Watch Demo on YouTube
  </a>
  <a href="https://x.com/Demion_L/status/2063671465271312628"
     target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:8px;
            padding:9px 20px;background:#0a0a14;
            color:#4fc3f7;border:1px solid #1a5c7c;border-radius:4px;
            font-family:'SF Mono','Fira Code',monospace;
            text-decoration:none;font-size:13px;letter-spacing:.06em;width:fit-content;">
    ↗ Post on X
  </a>
  <a href="https://github.com/Demion-L/reasoning-projector"
     target="_blank" rel="noopener noreferrer"
     style="display:inline-flex;align-items:center;gap:8px;
            padding:9px 20px;background:#0a0a14;
            color:#a0c8a0;border:1px solid #1a4c1a;border-radius:4px;
            font-family:'SF Mono','Fira Code',monospace;
            text-decoration:none;font-size:13px;letter-spacing:.06em;width:fit-content;">
    ⌥ GitHub Repository
  </a>
</div>
"""

with gr.Blocks(
    title="Reasoning Projector",
    theme=gr.themes.Base(
        primary_hue="blue",
        neutral_hue="slate",
        font=gr.themes.GoogleFont("IBM Plex Mono"),
    ),
    css="footer{display:none!important}",
) as demo:
    gr.Markdown("# Reasoning Projector")
    gr.Markdown(_DESCRIPTION)
    gr.HTML(_LINKS)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
