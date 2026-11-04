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
PORT = 8001
MAX_BODY_BYTES = 64 * 1024
TIMEOUT_SECONDS = max(30, int(os.environ.get("RETROSYNTHESIS_PREDICTOR_TIMEOUT_SECONDS", "240")))
SCRIPT = Path("/runtime/scripts/run_retrosynthesis_predictor.py")
MODEL = Path(
    "/runtime/predictor_data/GSETRetro-main/GSETRetro-main/GSETransformer/experiments/"
    "biochem_npl_20xaug/model_best_acc_step_355000_avg.pt"
)
MODEL_PATHS = {
    "gsetretro": MODEL,
    "readretro": Path("/runtime/predictor_data/READRetro-main/g2s/saved_models/biochem.pt"),
    "bionavi_np": Path(
        "/runtime/predictor_data/BioNavi-NP-main/BioNavi-NP-main/singlestep/"
        "checkpoints/np-like/model_step_100000.pt"
    ),
}
ENABLED_TOOLS = tuple(MODEL_PATHS)
RUN_SLOT = threading.BoundedSemaphore(1)


class PredictorHandler(BaseHTTPRequestHandler):
    server_version = "ReactEnzDBPredictor/1.0"

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
        missing = [tool for tool, model in MODEL_PATHS.items() if not model.is_file()]
        ready = SCRIPT.is_file() and not missing
        self.send_json(
            200 if ready else 503,
            {"status": "ok" if ready else "not_ready", "tools": list(ENABLED_TOOLS), "missing": missing},
        )

    def do_POST(self) -> None:
        if self.path != "/predict":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length."})
            return
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "Prediction request body is too large or empty."})
            return
        try:
            request = json.loads(self.rfile.read(content_length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON."})
            return
        tool = request.get("tool")
        target = request.get("target")
        top_k = request.get("topK", 5)
        if tool not in ENABLED_TOOLS:
            self.send_json(400, {"error": "Unknown CPU retrosynthesis adapter."})
            return
        if not isinstance(target, str) or not target.strip() or len(target) > 2000:
            self.send_json(400, {"error": "Provide one valid target SMILES under 2,000 characters."})
            return
        try:
            top_k = max(1, min(int(top_k), 10))
        except (TypeError, ValueError):
            self.send_json(400, {"error": "topK must be an integer from 1 to 10."})
            return
        if not RUN_SLOT.acquire(blocking=False):
            self.send_json(429, {"error": "The CPU predictor is busy. Please retry shortly."})
            return
        started = time.monotonic()
        try:
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--tool", tool, "--target", target.strip(), "--top-k", str(top_k)],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
                env=os.environ.copy(),
            )
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "Prediction failed.").strip()
                sys.stderr.write(detail[-4000:] + "\n")
                self.send_json(422, {"error": f"{tool} could not return a result for this target."})
                return
            payload = json.loads(completed.stdout.strip())
            payload["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self.send_json(200, payload)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": f"{tool} prediction timed out."})
        except (OSError, json.JSONDecodeError) as error:
            sys.stderr.write(f"Predictor runtime error: {error}\n")
            self.send_json(500, {"error": "The CPU retrosynthesis runtime is unavailable."})
        finally:
            RUN_SLOT.release()


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), PredictorHandler)
    print(f"ReactEnzDB CPU retrosynthesis predictor listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()
