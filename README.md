# Loop phone test (THROWAWAY)

A single throwaway page for checking what a phone browser can do with long-running audio: background playback with the screen locked, lock-screen controls, offline caching, and sleep timers. It's plain HTML/JS with no build step.

**Planned deletion: Thu Oct 15, 2026.** It isn't linked from anywhere.

- Page: https://anatolek-az.github.io/loop-phone-test/
- Test script: the steps live on the page cards; [TEST_SCRIPT.md](TEST_SCRIPT.md) is a reference copy (rendered at `/TEST_SCRIPT.html`).

## Page layout (v2, Oct 11 2026, after Critiquito's review)
- A 3-line intro box, then one **Sound to test** picker (real names; video quality moved into details, 720p default).
- Six step cards ordered by time, quick ones first. Each has a time estimate, a plain question, 1–2 numbered steps, one big primary button, **It worked / It didn't**, and a closed **Engineer details** toggle holding all readouts and logs.
- Optional 7th card: Home Screen app, with icon-by-icon instructions.
- Pinned bottom bar: **Step X of 6 · Next →** and **Send results**. Send results builds a plain-text summary (answers, notes, key readouts, short log) and opens the Web Share sheet (`navigator.share`); if that isn't available it copies to the clipboard and shows the text in a box. Nothing is sent to a server.
- Answers, notes, the picked sound and the detailed checklist are kept in localStorage.
- Backup of the v1 page: `_backup_2026-10-11/`.

| Card on page | Engineering test | Element ids kept |
|---|---|---|
| Step 1 | 2 · Media Session | `#t2` |
| Step 2 | 3 · muted looping video + separate audio | `#t3` |
| Step 3 | 5 · fixed pre-faded timer files | `#t5` |
| Step 4 | 1 · background `<audio>` all-night | `#t1` |
| Step 5 | 6 · pick any duration (Web Audio, keep-alive A/B/C) | `#t6` |
| Step 6 | 4 · download once, play offline (SW Range 206) | `#t4` |

## Tests on the page (unchanged logic)
1. Background audio (`<audio>`, all-night loop) with the screen locked, both as a Safari tab and as a Home Screen app.
2. Media Session: lock-screen metadata, artwork, and play/pause/seek handlers.
3. A looping muted video next to separate audio (drift, and resume after unlock).
4. Download once and play offline: a service worker answers Range requests from Cache Storage with 206.
5. Sleep timer using **fixed, pre-faded files** (15 and 30 min).
6. **Pick any duration.** A slider runs from 10 min to 8 h in 5-min steps (default 15 min).
   - It loops a 4-min clip with Web Audio: `AudioBufferSourceNode(loop) → GainNode → destination`.
   - The 3-min fade to silence and the stop are scheduled up front on the AudioContext clock.
   - Keep-alive modes:
     - **A** (default) adds a near-silent looping `<audio>`.
     - **B** is Web Audio only.
     - **C** routes Web Audio into `<audio>` through a MediaStream.
   - `?fast=1` is for debugging only and maps 1 min to 1 s.

## Loop file (test 6)
`tools/make_loops.py` takes the first 240 s of each session's `audio_allnight_60m.m4a`, decoded with the MP4 edit list honoured.
- It bakes in a 2 s equal-power crossfade (from 240–242 s into 0–2 s).
- It encodes AAC 128k with a 0.5 s margin of the loop's own audio on both sides.
- The page loops `[0.5 s, 240.5 s)` through `loopStart`/`loopEnd`. That keeps AAC priming and padding off the seam, whether or not the browser honours the edit list.
- `healSeam()` blends the last 250 ms before `loopEnd` into the identical material just before `loopStart`. The jump then lands on contiguous decoded samples.
- Checks:
  - `tools/loop_qc.py` runs offline with ffmpeg, with the edit list both honoured and ignored.
  - `tools/headless_check.mjs` uses headless Chrome to render the seam through Web Audio and runs the fast fade in all 3 modes.

## Hosting
- **GitHub Pages** (`gh-pages` branch, same origin) serves the 720p video, the 60-min all-night audio, the 15 and 30-min timers, the 4-min loop, the poster and a public manifest.
- The **GitHub release `media-v1`** holds the 1080p video and the 60 and 90-min timers. They're listed in each manifest, and the page doesn't use them (they'd be cross-origin).
- `./publish.sh` rebuilds and redeploys everything, then checks for 200 on the page and 206 on a Range request for a media file. It only re-renders the 4-min loops when `build/loops/` is missing (or `FORCE_LOOPS=1`); seed `build/loops/<id>/` from the live `_site` copy to avoid re-rendering.

## Local
`python3 server.py 8787` serves the page and media at `http://localhost:8787/` with Range support. `node tools/serve_site.mjs _site 8795` serves the built site under `/loop-phone-test/`, the same way Pages does.
