"""
Gradio wrapper for Reasoning Projector.

Starts the Next.js app as a subprocess then shows a static launcher page
with a single link to the running Next.js app.

Local usage (two-step):
    npm run build && npm run start   # terminal 1
    python app.py                    # terminal 2

Local usage (single command, let this script manage Next.js):
    START_NEXTJS=1 python app.py

On HF Spaces:
    Node.js is installed via packages.txt.
    This script builds (if needed) and starts Next.js automatically.
"""

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

# On HF Spaces the button must use the relative proxy path — not the full
# hf.space URL, which resolves back to the Gradio root (port 7860).
APP_HREF = "/proxy/3000/" if ON_HF else f"http://localhost:{NEXTJS_PORT}"

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

with gr.Blocks(
    title="Reasoning Projector",
    theme=gr.themes.Base(
        primary_hue="blue",
        neutral_hue="slate",
        font=gr.themes.GoogleFont("IBM Plex Mono"),
    ),
    css="footer{display:none!important}",
) as demo:
    gr.HTML(f"""
    <div style="display:flex;flex-direction:column;align-items:center;
                justify-content:center;min-height:70vh;
                font-family:'IBM Plex Mono',monospace;background:#020408;
                color:#c8d6e0;padding:2rem;text-align:center;">
      <h1 style="font-size:22px;letter-spacing:.12em;color:#4fc3f7;margin:0 0 12px;">
        🧠 REASONING PROJECTOR
      </h1>
      <p style="font-size:13px;color:#8aa8b8;max-width:480px;
                line-height:1.6;margin:0 0 32px;">
        Replay the signal trail behind engineering decisions.<br>
        Surface the <em>Reasoning Debt</em> that no API can recover.
      </p>
      <a href="{APP_HREF}" target="_blank" rel="noopener noreferrer"
         style="display:inline-flex;align-items:center;gap:8px;
                padding:12px 28px;background:#04111a;
                color:#4fc3f7;border:1px solid #1a5c7c;border-radius:4px;
                font-family:'IBM Plex Mono',monospace;font-size:13px;
                letter-spacing:.1em;text-decoration:none;">
        ↗ Open Reasoning Projector
      </a>
    </div>
    """)

# ─── Launch ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    demo.launch(
        server_name="0.0.0.0",
        server_port=GRADIO_PORT,
    )
