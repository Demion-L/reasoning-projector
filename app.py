"""
Gradio wrapper for Reasoning Projector.

Starts the Next.js app as a subprocess and embeds it via iframe.
The Gradio interface satisfies the Build Small hackathon requirement
(sdk: gradio); the Next.js app is the actual interactive experience.

Local usage (two-step):
    npm run build && npm run start   # terminal 1
    python app.py                    # terminal 2

Local usage (single command, let this script manage Next.js):
    START_NEXTJS=1 python app.py

On HF Spaces:
    Node.js is installed via packages.txt.
    This script builds (if needed) and starts Next.js automatically.
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time

import gradio as gr

# ─── Configuration ────────────────────────────────────────────────────────────

ROOT        = os.path.dirname(os.path.abspath(__file__))
NEXTJS_PORT = int(os.environ.get("NEXTJS_PORT", 3000))
GRADIO_PORT = int(os.environ.get("GRADIO_PORT", 7860))
ON_HF       = bool(os.environ.get("SPACE_ID"))

def _default_nextjs_url(port: int) -> str:
    # On HF Spaces, SPACE_ID is set (e.g. "demionAlGrande/reasoning-projector-openbmb").
    # Chrome blocks iframes pointing at localhost from a public page, so use the
    # Space's public proxy URL instead.
    space_id = os.environ.get("SPACE_ID", "")
    if space_id:
        slug = space_id.lower().replace("/", "-")
        return f"https://{slug}.hf.space/proxy/{port}/"
    return f"http://localhost:{port}"

NEXTJS_URL = os.environ.get("NEXTJS_URL") or _default_nextjs_url(NEXTJS_PORT)

# On HF Spaces START_NEXTJS defaults to "1"; set to "0" to skip when you
# start Next.js yourself in a separate terminal.
START_NEXTJS = os.environ.get("START_NEXTJS", "1") != "0"

# ─── Build Next.js if .next is missing ───────────────────────────────────────

_next_dir = os.path.join(ROOT, ".next")

if START_NEXTJS and not os.path.isdir(_next_dir):
    print("[setup] .next not found — building Next.js app (this may take ~60 s)...",
          flush=True)
    subprocess.run(["npm", "ci"], cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    print("[setup] Next.js build complete.", flush=True)

# ─── Start Next.js server ─────────────────────────────────────────────────────

def _run_nextjs() -> None:
    env = {**os.environ, "PORT": str(NEXTJS_PORT)}
    proc = subprocess.Popen(
        ["npm", "run", "start"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    for line in iter(proc.stdout.readline, b""):
        print("[next]", line.decode().rstrip(), flush=True)

def _wait_for_port(host: str, port: int, timeout: float = 120) -> bool:
    """Poll until something is listening on host:port, or timeout is reached."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(2)
    return False

if START_NEXTJS:
    threading.Thread(target=_run_nextjs, daemon=True).start()
    print(f"[setup] waiting for Next.js on port {NEXTJS_PORT}…", flush=True)
    if _wait_for_port("127.0.0.1", NEXTJS_PORT, timeout=120):
        print(f"[setup] Next.js is up on port {NEXTJS_PORT}.", flush=True)
    else:
        print(f"[setup] ⚠ Next.js did not start within 120 s — continuing anyway.",
              flush=True)

# ─── Gradio interface ─────────────────────────────────────────────────────────

_DESCRIPTION = """\
## What is Reasoning Projector?

Every engineering decision carries invisible context:
*who* made the call and *why*, which alternatives were
considered and rejected, and what rationale was never
written down.

Over time this context evaporates. **Reasoning Projector**
makes it visible by replaying the signal trail from
incidents → decision → ADR, and surfaces the gaps —
**Reasoning Debt** — that no API can recover.

> Click **REPLAY MEMORY** on the canvas to reconstruct a decision.
> Click any node to inspect its signals, rejected alternatives, and lost context.
"""

_link_html = (
    f'<a href="{NEXTJS_URL}" target="_blank" rel="noopener noreferrer" '
    f'style="display:inline-flex;align-items:center;gap:6px;'
    f'padding:7px 18px;background:#0a0a14;'
    f'color:#4fc3f7;border:1px solid #1a5c7c;border-radius:4px;'
    f'font-family:\'SF Mono\',\'Fira Code\',monospace;'
    f'text-decoration:none;font-size:12px;letter-spacing:.08em;">'
    f'↗ Open Reasoning Projector'
    f'</a>'
)

_iframe_html = (
    f'<div style="border:1px solid #1a2a3a;border-radius:6px;overflow:hidden;">'
    f'<iframe src="{NEXTJS_URL}" '
    f'style="width:100%;height:720px;border:none;display:block;background:#020408;" '
    f'title="Reasoning Projector" allow="cross-origin-isolated">'
    f'<p style="padding:1rem;font-family:monospace;">'
    f'Iframe blocked by your browser. '
    f'<a href="{NEXTJS_URL}">Open Reasoning Projector</a>.'
    f'</p>'
    f'</iframe>'
    f'</div>'
)

if ON_HF:
    # On HF Spaces the iframe src can resolve back to the Gradio page (port 7860)
    # if the proxy for port 3000 isn't ready, which causes infinite recursive
    # embedding. Redirect the browser directly to the Next.js app instead —
    # browsers stop redirect loops gracefully, iframe loops do not.
    _nextjs_url_js = json.dumps(NEXTJS_URL)
    with gr.Blocks(
        title="Reasoning Projector",
        css="footer{display:none!important}",
    ) as demo:
        gr.HTML(f"""
        <div style="display:flex;align-items:center;justify-content:center;
                    height:80vh;font-family:'IBM Plex Mono',monospace;
                    background:#020408;color:#4fc3f7;">
          <div style="text-align:center;">
            <p style="font-size:13px;letter-spacing:.1em;">LOADING REASONING PROJECTOR…</p>
            <p style="font-size:11px;color:#4a7a8a;margin-top:8px;">
              <a href="{NEXTJS_URL}" style="color:#4fc3f7;">Click here if not redirected</a>
            </p>
          </div>
        </div>
        <script>window.location.replace({_nextjs_url_js});</script>
        """)
else:
    with gr.Blocks(
        title="Reasoning Projector",
        theme=gr.themes.Base(
            primary_hue="blue",
            neutral_hue="slate",
            font=gr.themes.GoogleFont("IBM Plex Mono"),
        ),
        css="footer{display:none!important}",
    ) as demo:
        gr.Markdown("# 🧠 Reasoning Projector")
        gr.Markdown(_DESCRIPTION)
        gr.HTML(_link_html)
        gr.HTML(_iframe_html)

# ─── Launch ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    demo.launch(
        server_name="0.0.0.0",
        server_port=GRADIO_PORT,
    )
