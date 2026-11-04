from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


HOST = "0.0.0.0"
PORT = 8002
MAX_BODY_BYTES = 64 * 1024
TIMEOUT_SECONDS = max(30, int(os.environ.get("RETROBIOCAT_TIMEOUT_SECONDS", "240")))
ADAPTER = Path(os.environ.get("RETROBIOCAT_ADAPTER", str(Path(__file__).resolve().with_name("adapter.py"))))
SOURCE = Path(os.environ.get("RETROBIOCAT_SOURCE_ROOT", "/runtime/retrobiocat/source"))
RULES = Path(os.environ.get("RETROBIOCAT_RULES_YAML", "/runtime/retrobiocat/data/rxns_yaml.yaml"))
BUILDING_BLOCKS = Path(
    os.environ.get("RETROBIOCAT_BUILDING_BLOCKS_DB", "/runtime/retrobiocat/data/building_blocks.db")
)
RUN_SLOT = threading.BoundedSemaphore(1)


class RetroBioCatHandler(BaseHTTPRequestHandler):
    server_version = "ReactEnzDBRetroBioCat/1.0"

    def log_message(self, format_string: str, *args: Any) -> None:
        sys.stderr.write(f"{self.address_string()} - {format_string % args}\n")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "Not found."})
            return
        missing = [str(path) for path in (ADAPTER, SOURCE, RULES, BUILDING_BLOCKS) if not path.exists()]
        self.send_json(200 if not missing else 503, {"status": "ok" if not missing else "not_ready", "missing": missing})

    def do_POST(self) -> None:
        if self.path != "/plan":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                raise ValueError
            request = json.loads(self.rfile.read(content_length))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON under 64 KiB."})
            return
        target = request.get("target")
        if not isinstance(target, str) or not target.strip() or len(target) > 2000:
            self.send_json(400, {"error": "Provide one valid target SMILES under 2,000 characters."})
            return
        try:
            steps = max(1, min(int(request.get("steps", 2)), 3))
            top_k = max(1, min(int(request.get("topK", 5)), 10))
        except (TypeError, ValueError):
            self.send_json(400, {"error": "steps and topK must be integers."})
            return
        if not RUN_SLOT.acquire(blocking=False):
            self.send_json(429, {"error": "The RetroBioCat planner is busy. Please retry shortly."})
            return
        started = time.monotonic()
        try:
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ADAPTER),
                    "--target",
                    target.strip(),
                    "--steps",
                    str(steps),
                    "--top-k",
                    str(top_k),
                ],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
                env=os.environ.copy(),
            )
            if completed.returncode != 0:
                sys.stderr.write((completed.stderr or completed.stdout or "RetroBioCat failed.")[-6000:] + "\n")
                self.send_json(422, {"error": "RetroBioCat could not generate a pathway for this target."})
                return
            payload = json.loads(completed.stdout.strip())
            payload["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self.send_json(200, payload)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "RetroBioCat pathway planning timed out."})
        except (OSError, json.JSONDecodeError) as error:
            sys.stderr.write(f"RetroBioCat runtime error: {error}\n")
            self.send_json(500, {"error": "The RetroBioCat runtime is unavailable."})
        finally:
            RUN_SLOT.release()


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), RetroBioCatHandler)
    print(f"ReactEnzDB RetroBioCat planner listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
