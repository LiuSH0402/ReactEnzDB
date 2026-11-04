from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from engine import SubNetXEngine


ENGINE = SubNetXEngine()
RUN_SLOT = threading.BoundedSemaphore(1)


class Handler(BaseHTTPRequestHandler):
    server_version = "ReactEnzDB-SubNetX/1.0"

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, ENGINE.health())
            return
        if parsed.path == "/search":
            query = parse_qs(parsed.query).get("q", [""])[0]
            self.send_json(200, {"results": ENGINE.search(query, 10)})
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/extract":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 32_768:
                raise ValueError("Invalid request size.")
            payload = json.loads(self.rfile.read(length))
            target = str(payload.get("target") or "").strip()
            if not target or len(target) > 2_000:
                raise ValueError("Provide one target name, ARBRE/LCSB ID, InChIKey, or exact SMILES.")
            path_count = max(1, min(int(payload.get("pathCount") or 3), 5))
            rounds = max(0, min(int(payload.get("expansionRounds") or 0), 1))
            max_nodes = max(40, min(int(payload.get("maxNodes") or 120), 180))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
            return
        if not RUN_SLOT.acquire(blocking=False):
            self.send_json(429, {"error": "A SubNetX extraction is already running. Please retry shortly."})
            return
        try:
            self.send_json(200, ENGINE.extract(target, path_count, rounds, max_nodes))
        except ValueError as error:
            try:
                detail = json.loads(str(error))
            except json.JSONDecodeError:
                detail = {"message": str(error)}
            self.send_json(422, {"error": detail.get("message", "Extraction failed."), **{k: v for k, v in detail.items() if k != "message"}})
        except Exception as error:
            print(f"SubNetX extraction failed: {error}", flush=True)
            self.send_json(422, {"error": "The bounded SubNetX extractor could not return a candidate network for this target."})
        finally:
            RUN_SLOT.release()

    def log_message(self, format: str, *args: Any) -> None:
        print(f'{self.address_string()} - {format % args}', flush=True)


if __name__ == "__main__":
    print("Loading complete; ReactEnzDB SubNetX extractor listening on 0.0.0.0:8003", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8003), Handler).serve_forever()
