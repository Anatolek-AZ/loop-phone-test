#!/usr/bin/env python3
"""Throwaway static server for the loop phone test.
- Correct MIME types (m4a/mp4/webmanifest/js), HTTP Range (206) support, threaded.
- /media/<id>/...  -> ./media/<id>/...           (placeholders, gitignored)
- /pilots/<id>/... -> $PILOTS_DIR (default ../pilots)
- /sessions.json   -> auto-discovered list of folders that contain manifest.json
Usage: python3 server.py [port]   (default 8787)"""
import json, os, re, sys, mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PILOTS = os.environ.get("PILOTS_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pilots"))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
for ext, t in {".m4a": "audio/mp4", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json",
               ".js": "text/javascript", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
               ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml"}.items():
    mimetypes.add_type(t, ext)

def discover():
    out = []
    for src, base, url in (("pilot", PILOTS, "/pilots/"), ("placeholder", os.path.join(ROOT, "media"), "/media/")):
        if not os.path.isdir(base): continue
        for d in sorted(os.listdir(base)):
            m = os.path.join(base, d, "manifest.json")
            if os.path.isfile(m):
                title = d
                try: title = json.load(open(m)).get("title", d)
                except Exception: pass
                out.append({"id": d, "title": title, "source": src, "base": f"{url}{d}/"})
    return out

class H(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if p.startswith("/pilots/"):
            rel = os.path.normpath(p[len("/pilots/"):]).lstrip("/")
            if rel.startswith(".."): return "/nonexistent"
            return os.path.join(PILOTS, rel)
        full = super().translate_path(path)
        rel = os.path.relpath(full, ROOT)
        if rel.split(os.sep)[0] in (".git", "bin", "tools") or rel.endswith(".py"): return "/nonexistent"
        return full

    def end_headers(self):
        p = self.path.split("?")[0]
        if p.endswith((".html", ".js", ".webmanifest", ".json", "/")) or p == "/sw.js":
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_HEAD(self): self._serve(head=True)
    def do_GET(self): self._serve(head=False)

    def _serve(self, head):
        if self.path.split("?")[0] == "/sessions.json":
            body = json.dumps({"sessions": discover()}, indent=1).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            if not head: self.wfile.write(body)
            return
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            if not self.path.split("?")[0].endswith("/"):
                self.send_response(301); self.send_header("Location", self.path + "/"); self.send_header("Content-Length", "0"); self.end_headers(); return
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            self.send_error(404); return
        size = os.path.getsize(path); ctype = self.guess_type(path)
        rng = self.headers.get("Range")
        start, end, status = 0, size - 1, 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if not m or (m.group(1) == "" and m.group(2) == ""):
                self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.send_header("Content-Length", "0"); self.end_headers(); return
            if m.group(1) == "":
                start = max(0, size - int(m.group(2)))
            else:
                start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.send_header("Content-Length", "0"); self.end_headers(); return
            status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        if status == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Last-Modified", self.date_time_string(int(os.path.getmtime(path))))
        if os.path.basename(path) == "sw.js": self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        if head: return
        try:
            with open(path, "rb") as f:
                f.seek(start); left = length
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk: break
                    self.wfile.write(chunk); left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

if __name__ == "__main__":
    print(f"serving {ROOT} on :{PORT} (pilots: {PILOTS})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
