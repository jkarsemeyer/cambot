# CAMBOT local server for Mac/Linux. Serves this folder at http://localhost:8787.
import http.server
import os
import subprocess
import sys
import threading
import time
import webbrowser

PORT = 8787
URL = f"http://localhost:{PORT}/app/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass


def open_browser():
    time.sleep(0.8)
    if sys.platform == "darwin":
        if subprocess.call(["open", "-a", "Google Chrome", URL], stderr=subprocess.DEVNULL) == 0:
            return
    webbrowser.open(URL)


try:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
except OSError:
    print(f"Port {PORT} is already in use. CAMBOT may already be running, so opening it.")
    open_browser()
    sys.exit(0)

print(f"\n  CAMBOT is running at {URL}\n  Keep this window open while you use it. Close it to stop.\n")
threading.Thread(target=open_browser, daemon=True).start()
server.serve_forever()
