#!/usr/bin/env bash
# Start local server + free Cloudflare quick tunnel in the background. Logs/PIDs in .run/
# NOTE: quick tunnels need outbound 7844 (QUIC/TCP). Blocked on the shared box; works on a normal network.
set -e
cd "$(dirname "$0")"; mkdir -p .run
PORT="${PORT:-8787}"
[ -f media/placeholder-01/manifest.json ] || python3 tools/make_placeholders.py
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  nohup setsid python3 server.py "$PORT" > .run/server.log 2>&1 & echo $! > .run/server.pid
fi
CF=$(command -v cloudflared || echo bin/cloudflared)
if [ ! -x "$CF" ]; then
  mkdir -p bin; case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) A=cloudflared-linux-amd64;; Linux-aarch64) A=cloudflared-linux-arm64;; *) echo "install cloudflared manually"; exit 1;; esac
  curl -sSL -o bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/$A"; chmod +x bin/cloudflared; CF=bin/cloudflared
fi
nohup setsid "$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" > .run/tunnel.log 2>&1 & echo $! > .run/tunnel.pid
for i in $(seq 1 30); do U=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .run/tunnel.log | head -1); [ -n "$U" ] && break; sleep 1; done
echo "server pid $(cat .run/server.pid 2>/dev/null) · tunnel pid $(cat .run/tunnel.pid) · $U (check .run/tunnel.log for 'Registered tunnel connection')"
echo "$U" > .run/url
