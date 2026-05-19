"""
Minimal manga-ocr HTTP server.

Run:
    pip install -r requirements.txt
    python server.py

Listens on http://localhost:7331/ocr. POST JSON { "image": "<base64 PNG>" }.
Returns { "text": "..." }.

First request is slow (model warmup, ~5-15s). Subsequent requests are 200-800ms on CPU.
"""
import base64
import io
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image
from manga_ocr import MangaOcr

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("manga-ocr-server")

log.info("Loading manga-ocr model (first run downloads ~400MB)...")
MOCR = MangaOcr()
log.info("Model ready.")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        # Chrome extensions send Origin: chrome-extension://<id>. Allow anything;
        # this server should only ever be bound to localhost anyway.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/ocr":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            img_b64 = body["image"]
            img_bytes = base64.b64decode(img_b64)
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

            text = MOCR(img)
            log.info("OCR -> %s", text)

            payload = json.dumps({"text": text}).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            log.exception("OCR error")
            payload = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, fmt, *args):
        # Quiet the default access log; we log results above.
        pass


def main():
    addr = ("127.0.0.1", 7331)
    httpd = ThreadingHTTPServer(addr, Handler)
    log.info("Listening on http://%s:%d/ocr", *addr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        httpd.server_close()


if __name__ == "__main__":
    main()
