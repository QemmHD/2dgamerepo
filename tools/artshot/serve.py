#!/usr/bin/env python3
# Minimal static server with correct MIME types for ES modules + fonts.
# Also accepts PUT /__save/<name> — writes the request body under ROOT/__out/.
# Used by render harnesses (e.g. glbsheet.html) that build a PNG in-page and
# push it back to disk, which avoids the headless --screenshot / virtual-time
# timing problems with long async work (large GLB parses, image decodes).
import os, re, sys, http.server, socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
ROOT = sys.argv[2] if len(sys.argv) > 2 else "."

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a):
        pass
    def do_PUT(self):
        m = re.fullmatch(r"/__save/([A-Za-z0-9._-]+)", self.path)
        if not m or ".." in m.group(1):
            self.send_error(404)
            return
        out_dir = os.path.join(ROOT, "__out")
        os.makedirs(out_dir, exist_ok=True)
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        with open(os.path.join(out_dir, m.group(1)), "wb") as f:
            f.write(body)
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

class TCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
    httpd.serve_forever()
