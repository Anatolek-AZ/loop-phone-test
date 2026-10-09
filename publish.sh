#!/usr/bin/env bash
# Redeploy the throwaway loop phone test: loops -> _site -> release assets -> gh-pages branch -> verify.
# Needs: gh (logged in), git, ffmpeg, python3 with numpy (for make_loops), curl.
set -euo pipefail
cd "$(dirname "$0")"
REPO="${REPO:-Anatolek-AZ/loop-phone-test}"
PILOTS="${PILOTS_DIR:-../pilots}"
PY="${PY:-python3}"
TAG=media-v1
RELEASE_FILES=(video_1080.mp4 audio_timer_60m.m4a audio_timer_90m.m4a)
OWNER="${REPO%%/*}"; NAME="${REPO##*/}"
PAGES_URL="https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$NAME/"

# 1. 4-min loops (only rebuilt if missing or FORCE_LOOPS=1)
for d in "$PILOTS"/*/; do sid=$(basename "$d"); [ -f "$d/audio_allnight_60m.m4a" ] || continue
  if [ "${FORCE_LOOPS:-0}" = 1 ] || [ ! -f "build/loops/$sid/audio_loop_4m.m4a" ]; then "$PY" tools/make_loops.py "$PILOTS" build/loops; break; fi; done

# 2. static site
"$PY" tools/build_site.py "$PILOTS" build/loops _site "$REPO"

# 3. release assets (idempotent; existing names are skipped, set CLOBBER=1 to replace)
gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 || gh release create "$TAG" -R "$REPO" --title "media-v1 (throwaway)" \
  --notes "Large media for the throwaway loop phone test (not used by the page). Planned deletion: Thu Oct 15, 2026."
have=$(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name')
mkdir -p build/release
for d in "$PILOTS"/*/; do sid=$(basename "$d"); [ -f "_site/pilots/$sid/manifest.json" ] || continue
  for f in "${RELEASE_FILES[@]}"; do a="${sid}__${f}"; [ -f "$d/$f" ] || continue
    if [ "${CLOBBER:-0}" = 1 ] || ! grep -qx "$a" <<<"$have"; then ln -f "$d/$f" "build/release/$a" 2>/dev/null || cp "$d/$f" "build/release/$a"
      gh release upload "$TAG" "build/release/$a" -R "$REPO" --clobber; fi; done; done

# 4. gh-pages branch via a worktree (normal commits, no force-push)
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
git fetch -q origin gh-pages 2>/dev/null || true
if [ ! -d build/gh-pages/.git ] && [ ! -f build/gh-pages/.git ]; then
  rm -rf build/gh-pages
  if git rev-parse -q --verify origin/gh-pages >/dev/null; then git worktree add -B gh-pages build/gh-pages origin/gh-pages
  else git worktree add --detach build/gh-pages && (cd build/gh-pages && git checkout -q --orphan gh-pages && git rm -rqf . >/dev/null 2>&1 || true); fi
fi
rsync -a --delete --exclude .git _site/ build/gh-pages/
( cd build/gh-pages && git add -A && { git diff --cached --quiet || git commit -qm "deploy $(date -u +%Y-%m-%dT%H:%MZ)"; } && git push -q origin gh-pages )

# 5. source branch
git push -q origin HEAD:main || echo "warn: could not push source branch"

# 6. Pages on (gh-pages /)
gh api "repos/$REPO/pages" >/dev/null 2>&1 || gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null

# 7. wait for the build, then verify 200 + Range 206 from the Pages origin
for i in $(seq 1 60); do
  st=$(gh api "repos/$REPO/pages/builds/latest" -q .status 2>/dev/null || echo none)
  [ "$st" = built ] && break; [ "$st" = errored ] && { echo "Pages build errored"; exit 1; }; sleep 10; done
sid=$(python3 -c "import json;print(json.load(open('_site/sessions.json'))['sessions'][0]['id'])")
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' "$PAGES_URL"); [ "$c" = 200 ] && break; sleep 10; done
echo "page: $PAGES_URL -> $c"
echo "test script: ${PAGES_URL}TEST_SCRIPT.html -> $(curl -s -o /dev/null -w '%{http_code}' "${PAGES_URL}TEST_SCRIPT.html")"
for f in audio_loop_4m.m4a audio_allnight_60m.m4a video_720.mp4; do
  echo "$f: $(curl -s -o /dev/null -D - -H 'Range: bytes=1000-1999' "${PAGES_URL}pilots/$sid/$f" | tr -d '\r' | grep -iE '^(HTTP|content-range|content-type|accept-ranges)' | tr '\n' ' ')"; done
