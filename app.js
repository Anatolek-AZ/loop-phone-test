/* Loop phone test (throwaway). Plain JS, no build step. */
'use strict';
const $ = (id) => document.getElementById(id);
const aud = $('aud'), vid = $('vid');
const MEDIA_CACHE = 'tw-media-v2';   // must match sw.js MEDIA
const LS = { checks: 'tw_checks_v1', notes: 'tw_notes_v1', downloads: 'tw_downloads_v1', evict: 'tw_evict_hist_v1', log: 'tw_log_v1' };
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { log('all', 'localStorage write failed: ' + e); } };

const standalone = !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches);
const displayMode = ['standalone', 'minimal-ui', 'fullscreen', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) || 'unknown';
const iosVer = (navigator.userAgent.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac/) || []).slice(1).filter(Boolean).join('.') || null;
const modeLabel = (standalone ? 'HOME SCREEN app' : 'browser tab') + ` (display-mode: ${displayMode})` + (document.documentElement.dataset.mui ? ' [minimal-ui manifest]' : '');

// ---------- logging ----------
const t0 = Date.now();
const fmtClock = (d = new Date()) => d.toLocaleTimeString([], { hour12: false });
const fmtDur = (s) => { if (!isFinite(s)) return '--:--'; s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const allLines = [];
function log(sec, msg) {
  const line = `${fmtClock()} ${document.hidden ? '[hidden] ' : ''}${msg}`;
  allLines.push(`[${sec}] ${line}`);
  const box = $('log' + sec) || null;
  if (box) { box.textContent = line + '\n' + box.textContent.slice(0, 4000); }
  const all = $('logAll'); if (all) all.textContent = `[${sec}] ${line}\n` + all.textContent.slice(0, 8000);
  // persist a short rolling log so background events survive a reload
  const stored = lsGet(LS.log, []); stored.push(`${new Date().toISOString()} [${sec}] ${msg}`); lsSet(LS.log, stored.slice(-150));
}

$('env').textContent = `${modeLabel} · iOS ${iosVer || 'n/a'} · SW ${'serviceWorker' in navigator ? 'yes' : 'no'} · MediaSession ${'mediaSession' in navigator ? 'yes' : 'no'} · ${navigator.userAgent}`;
$('mode').textContent = modeLabel;

// ---------- sessions / manifest ----------
let sessions = [], session = null; // session = {id,title,base,source,manifest,files:{...}}
function inferRole(name) {
  if (/^video_(\d+)\.mp4$/i.test(name)) return 'video';
  if (/^audio_loop/i.test(name)) return 'audio_loop';
  if (/^audio_allnight/i.test(name)) return 'audio_allnight';
  if (/^audio_timer_/i.test(name)) return 'audio_timer';
  if (/^poster\.(jpe?g|png|webp)$/i.test(name)) return 'poster';
  return 'other';
}
function normalizeManifest(m) {
  let list = Array.isArray(m.files) ? m.files : (m.files && typeof m.files === 'object')
    ? Object.entries(m.files).map(([k, v]) => (typeof v === 'object' ? { file: v.file || v.name || v.path || k, ...v } : { file: k }))
    : [];
  return list.map((f) => {
    const file = (f.file || f.name || f.path || '').split('/').pop();
    const dur = Number(f.duration_s ?? f.duration_sec ?? f.duration ?? f.seconds ?? NaN);
    const bytes = Number(f.bytes ?? f.size_bytes ?? f.size ?? NaN);
    const role = f.role || inferRole(file);
    const height = Number(f.height || (file.match(/^video_(\d+)/) || [])[1] || NaN);
    let timerMin = Number(f.timer_min ?? (file.match(/audio_timer_(\d+)m/) || [])[1] ?? NaN);
    return { file, dur, bytes, role, height, timerMin };
  }).filter((f) => f.file);
}
async function loadSessions() {
  try {
    const r = await fetch('sessions.json', { cache: 'no-cache' });
    sessions = (await r.json()).sessions || [];
  } catch (e) { log('all', 'sessions.json failed (offline?): ' + e); sessions = lsGet('tw_sessions_cache', []); }
  if (sessions.length) lsSet('tw_sessions_cache', sessions);
  const sel = $('session'); sel.innerHTML = '';
  sessions.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${s.title} (${s.source})`; sel.appendChild(o); });
  const pref = sessions.findIndex((s) => s.source === 'pilot');
  if (sessions.length) await selectSession(pref >= 0 ? pref : 0);
  else $('sessionInfo').textContent = 'No sessions found.';
}
async function selectSession(i) {
  const s = sessions[i]; if (!s) return;
  $('session').value = i;
  const r = await fetch(s.base + 'manifest.json', { cache: 'no-cache' }).catch(() => null);
  let m = null;
  if (r && r.ok) m = await r.json();
  else { const c = await caches.open(MEDIA_CACHE); const cr = await c.match(s.base + 'manifest.json'); if (cr) m = await cr.json(); }
  if (!m) { $('sessionInfo').textContent = 'manifest.json not reachable for ' + s.id; return; }
  const files = normalizeManifest(m);
  session = { ...s, manifest: m, list: files,
    allnight: files.find((f) => f.role === 'audio_allnight'),
    timers: files.filter((f) => f.role === 'audio_timer').sort((a, b) => (a.timerMin || a.dur) - (b.timerMin || b.dur)),
    videos: files.filter((f) => f.role === 'video'),
    poster: files.find((f) => f.role === 'poster'),
    loop: files.find((f) => f.role === 'audio_loop') };
  $('sessionInfo').textContent = `${m.title || s.id} · ${s.source}${m.placeholder ? ' (placeholder)' : ''} · ${files.length} files · base ${s.base}`;
  log('all', `session ${s.id} loaded (${s.source}), ${files.length} files`);
  setVideo(); buildTimerButtons(); setMediaMetadata();
  if (!playing) setAudio(session.allnight, true);
  refreshCacheStatus(); checkServedFrom();
}
const url = (f) => f ? session.base + f.file : '';
function pickVideo() {
  const want = Number($('vres').value);
  return session.videos.find((v) => v.height === want) || session.videos[0];
}

// ---------- 3: video ----------
let videoWanted = false, vLoops = 0, vLast = 0;
function setVideo() {
  const v = pickVideo(); if (!v) return;
  const wasPlaying = !vid.paused;
  vid.src = url(v); vid.poster = url(session.poster); vLoops = 0;
  vid.muted = true; vid.loop = true; vid.playsInline = true;
  if (wasPlaying || videoWanted) vid.play().catch((e) => log(3, 'video play rejected: ' + e.name));
  log(3, 'video src ' + v.file);
}
$('vres').onchange = setVideo;
vid.addEventListener('timeupdate', () => { if (vid.currentTime + 0.5 < vLast) { vLoops++; } vLast = vid.currentTime; });
['play', 'pause', 'stalled', 'waiting', 'error'].forEach((ev) => vid.addEventListener(ev, () => log(3, `video ${ev}${ev === 'error' && vid.error ? ' code ' + vid.error.code : ''}`)));

// ---------- 1: audio ----------
let playing = false, playStartWall = 0, listened = 0, aLast = 0, timerMode = null;
function setAudio(f, loop) {
  if (!f) { log(1, 'no audio file in manifest for this role'); return; }
  aud.src = url(f); aud.loop = !!loop; aLast = 0;
  $('asrc').textContent = f.file + (loop ? ' (loop)' : '');
}
async function play() {
  if (!session) return;
  if (!aud.src) setAudio(session.allnight, true);
  try { await aud.play(); } catch (e) { log(1, 'audio play rejected: ' + e.name + ' ' + e.message); return; }
  if (!playing) { playStartWall = Date.now(); listened = 0; }
  playing = true; videoWanted = true;
  vid.play().catch((e) => log(3, 'video play rejected: ' + e.name));
  setMediaMetadata(); setHandlers();
  log(1, 'play ' + aud.src.split('/').pop());
}
function pause(reason = 'button') {
  aud.pause(); vid.pause(); playing = false; videoWanted = false; log(1, 'pause (' + reason + ')');
}
$('btnPlay').onclick = () => { if (anyActive()) anyStop('test 1 started'); if (timerMode) cancelTimer(false); setAudio(session.allnight, true); play(); };
$('btnPause').onclick = () => pause();
aud.addEventListener('timeupdate', () => {
  const c = aud.currentTime, d = aud.duration;
  let dt = c - aLast; if (dt < 0 && isFinite(d)) dt = c + (d - aLast);
  if (dt > 0 && dt < 5) listened += dt;
  aLast = c;
  if (document.hidden) hiddenTimeupdates++;
  updatePosition();
});
['play', 'pause', 'ended', 'stalled', 'waiting', 'suspend', 'error', 'loadedmetadata'].forEach((ev) => aud.addEventListener(ev, () => {
  if (ev === 'suspend' && !document.hidden) return; // noisy
  log(1, `audio ${ev}${ev === 'error' && aud.error ? ' code ' + aud.error.code : ''}${ev === 'loadedmetadata' ? ' dur ' + fmtDur(aud.duration) : ''}`);
  if (ev === 'pause' && playing && document.hidden) log(1, '⚠︎ audio paused by the SYSTEM while hidden');
}));

// visibility: measure what happened while hidden
let hid = null, hiddenTimeupdates = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hid = { wall: Date.now(), listened, c: aud.currentTime, paused: aud.paused, vpaused: vid.paused, src: aud.src }; hiddenTimeupdates = 0;
    log('all', `hidden · audio ${aud.paused ? 'paused' : 'playing'} · video ${vid.paused ? 'paused' : 'playing'}`);
  } else if (hid) {
    const dt = (Date.now() - hid.wall) / 1000, d = aud.duration;
    let adv = aud.currentTime - hid.c;
    if (aud.src === hid.src && isFinite(d) && aud.loop) { const base = ((adv % d) + d) % d; adv = base + d * Math.max(0, Math.round((dt - base) / d)); }
    if (playing) listened = hid.listened + Math.max(0, adv); aLast = aud.currentTime;
    const ok = !hid.paused && adv > dt * 0.9;
    const msg = `while hidden ${fmtDur(dt)}: audio advanced ${fmtDur(adv)}${ok ? ' ✅ kept playing' : hid.paused ? ' (was paused)' : ' ❌ stopped/stalled'} · now ${aud.paused ? 'paused' : 'playing'} · ${hiddenTimeupdates} timeupdates fired in bg`;
    $('hiddenRes').textContent = msg; $('hiddenRes').className = ok ? 'ok' : hid.paused ? '' : 'bad';
    log(1, msg);
    log(3, `unlock: video was ${hid.vpaused ? 'paused' : 'playing'} at hide, now ${vid.paused ? 'paused' : 'playing'}`);
    if (videoWanted && vid.paused) {
      vid.play().then(() => { $('vres2').textContent = 'resumed ' + fmtClock(); log(3, 'video auto-resumed on visibilitychange'); })
        .catch((e) => { $('vres2').textContent = 'resume failed: ' + e.name; log(3, 'video auto-resume failed: ' + e.name); });
    }
    if (wakeWanted) requestWake();
    hid = null; refreshCacheStatus();
  }
});
window.addEventListener('pagehide', () => log('all', 'pagehide')); window.addEventListener('pageshow', (e) => log('all', 'pageshow persisted=' + e.persisted));

// wake lock (optional)
let wakeWanted = false, wakeSentinel = null;
async function requestWake() {
  if (!('wakeLock' in navigator)) { log(1, 'Wake Lock API not supported here'); return; }
  try { wakeSentinel = await navigator.wakeLock.request('screen'); wakeSentinel.addEventListener('release', () => log(1, 'wake lock released')); log(1, 'wake lock acquired'); }
  catch (e) { log(1, 'wake lock failed: ' + e.name); }
}
$('btnWake').onclick = async () => {
  wakeWanted = !wakeWanted; $('btnWake').textContent = 'Wake lock: ' + (wakeWanted ? 'on' : 'off');
  if (wakeWanted) requestWake(); else if (wakeSentinel) { wakeSentinel.release(); wakeSentinel = null; }
};

// ---------- 2: Media Session ----------
const ms = navigator.mediaSession;
$('msSup').textContent = ms ? 'yes (setPositionState: ' + (ms && 'setPositionState' in ms ? 'yes' : 'no') + ')' : 'NO';
function setMediaMetadata() {
  if (!ms || !session) return;
  const m = session.manifest;
  const art = [];
  if (session.poster) art.push({ src: new URL(url(session.poster), location.href).href, sizes: '1920x1080', type: 'image/jpeg' });
  art.push({ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' });
  ms.metadata = new MediaMetadata({ title: (m.title || session.id) + (timerMode ? ` · ${timerMode} timer` : ''), artist: m.artist || 'Loop phone test', album: m.world || 'Loop phone test', artwork: art });
}
function msAction(a, fn) { try { ms.setActionHandler(a, fn ? (d) => { $('msLast').textContent = a + ' @ ' + fmtClock(); log(2, 'action ' + a + (d && d.seekTime != null ? ' ' + d.seekTime.toFixed(1) : '')); fn(d); } : null); } catch (e) { log(2, `setActionHandler(${a}) unsupported`); } }
function setHandlers() {
  if (!ms) return;
  msAction('play', () => (anyActive() ? anyResume('lock screen') : play()));
  msAction('pause', () => (anyActive() ? anyPause('lock screen') : pause('lock screen')));
  msAction('stop', () => (anyActive() ? anyStop('lock screen') : pause('lock screen stop')));
  const seek = $('msSeek').checked, track = $('msTrack').checked;
  msAction('seekbackward', seek ? (d) => { aud.currentTime = Math.max(0, aud.currentTime - (d.seekOffset || 15)); } : null);
  msAction('seekforward', seek ? (d) => { aud.currentTime = Math.min(aud.duration || 1e9, aud.currentTime + (d.seekOffset || 15)); } : null);
  msAction('seekto', (d) => { if (d.fastSeek && 'fastSeek' in aud) aud.fastSeek(d.seekTime); else aud.currentTime = d.seekTime; updatePosition(true); });
  msAction('previoustrack', track ? () => switchSession(-1) : null);
  msAction('nexttrack', track ? () => switchSession(1) : null);
  log(2, `handlers set (seek=${seek}, track=${track})`);
}
$('msSeek').onchange = setHandlers; $('msTrack').onchange = setHandlers;
async function switchSession(dir) {
  if (sessions.length < 2) { aud.currentTime = 0; log(2, 'only one session: restarted audio'); return; }
  const wasPlaying = playing; const i = (Number($('session').value) + dir + sessions.length) % sessions.length;
  if (timerMode) cancelTimer(false);
  playing = false; await selectSession(i); setAudio(session.allnight, true); if (wasPlaying) play();
}
$('session').onchange = async (e) => { const wasPlaying = playing; if (timerMode) cancelTimer(false); playing = false; aud.pause(); await selectSession(Number(e.target.value)); if (wasPlaying) play(); };
let lastPos = 0;
function updatePosition(force) {
  if (!ms || !('setPositionState' in ms)) return;
  const d = aud.duration; if (!isFinite(d) || d <= 0) return;
  if (!force && Date.now() - lastPos < 1000) return; lastPos = Date.now();
  try { ms.setPositionState({ duration: d, playbackRate: aud.playbackRate || 1, position: Math.min(aud.currentTime, d) }); $('msPos').textContent = `${fmtDur(aud.currentTime)} / ${fmtDur(d)}`; }
  catch (e) { $('msPos').textContent = 'setPositionState error: ' + e.name; }
}

// ---------- 5: sleep timer ----------
function buildTimerButtons() {
  const box = $('timerBtns'); box.innerHTML = '';
  if (!session.timers.length) { box.textContent = 'No timer files in manifest.'; return; }
  session.timers.forEach((f) => {
    const b = document.createElement('button'); const mins = f.timerMin || Math.round(f.dur / 60);
    b.textContent = `${mins} min`; b.onclick = () => startTimer(f, mins); box.appendChild(b);
  });
  const c = document.createElement('button'); c.textContent = 'Cancel → all-night'; c.onclick = () => cancelTimer(true); box.appendChild(c);
}
function startTimer(f, mins) {
  if (anyActive()) anyStop('test 5 started');
  timerMode = mins + ' min';
  setAudio(f, false); aud.currentTime = 0; playing = false; play();
  log(5, `timer ${mins} min started with ${f.file} (fade baked in), ends ≈ ${fmtClock(new Date(Date.now() + (f.dur || mins * 60) * 1000))}`);
}
function cancelTimer(resume) {
  if (!timerMode) return; log(5, 'timer cancelled'); timerMode = null;
  if (resume) { playing = false; setAudio(session.allnight, true); play(); }
}
aud.addEventListener('ended', () => {
  if (timerMode) { log(5, `⏹ timer ${timerMode} ended ${fmtClock()} (audio ended naturally)`); timerMode = null; playing = false; videoWanted = false; vid.pause(); }
});

// ---------- 4: offline ----------
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) { $('swState').textContent = 'not supported'; return; }
  try {
    swReg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    $('swState').textContent = (navigator.serviceWorker.controller ? 'active + controlling' : 'active (reload to control)') + ' · ' + swReg.scope;
    navigator.serviceWorker.addEventListener('controllerchange', () => { $('swState').textContent = 'active + controlling (changed)'; });
  } catch (e) { $('swState').textContent = 'register failed: ' + e; log(4, 'SW register failed: ' + e); }
}
function filesToCache() {
  const v = pickVideo();
  return [...session.list.filter((f) => f.role !== 'video'), v].filter(Boolean).map((f) => ({ path: url(f), f }))
    .concat([{ path: session.base + 'manifest.json', f: { file: 'manifest.json' } }]);
}
$('btnDl').onclick = async () => {
  if (!session) return;
  const cache = await caches.open(MEDIA_CACHE);
  const items = filesToCache(); let done = 0, total = 0;
  const btn = $('btnDl'); btn.disabled = true;
  try {
    for (const { path, f } of items) {
      const res = await fetch(path, { cache: 'reload' });
      if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
      const len = Number(res.headers.get('content-length')) || f.bytes || 0;
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      for (;;) { const { done: d, value } = await reader.read(); if (d) break; chunks.push(value); got += value.length;
        btn.textContent = `⬇︎ ${f.file} ${len ? Math.round(got / len * 100) + '%' : (got / 1e6).toFixed(1) + ' MB'} (${done + 1}/${items.length})`; }
      const blob = new Blob(chunks, { type: res.headers.get('content-type') || '' });
      await cache.put(path, new Response(blob, { headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' } }));
      done++; total += blob.size; log(4, `cached ${f.file} ${(blob.size / 1e6).toFixed(2)} MB`);
    }
    const dl = lsGet(LS.downloads, {}); dl[session.id] = { ts: new Date().toISOString(), base: session.base, files: items.map((i) => i.path), bytes: total }; lsSet(LS.downloads, dl);
    log(4, `✅ download complete: ${done} files, ${(total / 1e6).toFixed(1)} MB`);
    if (navigator.storage && navigator.storage.persist) { const p = await navigator.storage.persist(); log(4, 'persist() after download → ' + p); }
  } catch (e) { log(4, '❌ download failed: ' + e); }
  btn.disabled = false; btn.textContent = '⬇︎ Download session';
  refreshCacheStatus(); checkServedFrom();
};
$('btnPersist').onclick = async () => {
  if (!(navigator.storage && navigator.storage.persist)) { log(4, 'storage.persist not supported'); return; }
  const p = await navigator.storage.persist(); log(4, 'persist() → ' + p); refreshCacheStatus();
};
$('btnClear').onclick = async () => {
  await caches.delete(MEDIA_CACHE); const dl = lsGet(LS.downloads, {}); if (session) delete dl[session.id]; lsSet(LS.downloads, dl);
  log(4, 'media cache deleted'); refreshCacheStatus(); checkServedFrom();
};
async function refreshCacheStatus() {
  $('online').textContent = navigator.onLine ? 'yes' : 'NO (offline)';
  try {
    const c = await caches.open(MEDIA_CACHE); const keys = await c.keys(); let bytes = 0;
    for (const k of keys) { const r = await c.match(k); bytes += Number(r.headers.get('content-length')) || 0; }
    $('cacheFiles').textContent = `${keys.length} files · ${(bytes / 1e6).toFixed(1)} MB`;
  } catch (e) { $('cacheFiles').textContent = 'Cache API error: ' + e; }
  if (navigator.storage) {
    if (navigator.storage.persisted) $('persisted').textContent = String(await navigator.storage.persisted());
    if (navigator.storage.estimate) { const e = await navigator.storage.estimate(); $('estimate').textContent = `usage ${(e.usage / 1e6).toFixed(1)} MB / quota ${(e.quota / 1e9).toFixed(2)} GB`; }
  } else { $('persisted').textContent = 'StorageManager n/a'; }
}
window.addEventListener('online', refreshCacheStatus); window.addEventListener('offline', refreshCacheStatus);
async function checkServedFrom() {
  if (!session || !session.allnight) return;
  try {
    const r = await fetch(url(session.allnight), { headers: { Range: 'bytes=0-1' } });
    $('servedFrom').textContent = `${r.headers.get('x-from-sw-cache') ? 'Cache Storage via SW' : 'network'} (HTTP ${r.status}${r.headers.get('content-range') ? ', ' + r.headers.get('content-range') : ''})`;
  } catch (e) { $('servedFrom').textContent = 'not available offline: ' + e.name; }
}
async function evictionCheck() {
  const dl = lsGet(LS.downloads, {}); const hist = lsGet(LS.evict, []);
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  const c = await caches.open(MEDIA_CACHE);
  for (const [sid, info] of Object.entries(dl)) {
    let have = 0; for (const p of info.files) if (await c.match(p)) have++;
    const days = ((Date.now() - Date.parse(info.ts)) / 864e5).toFixed(2);
    hist.push({ ts: new Date().toISOString(), sid, have, total: info.files.length, days, persisted, standalone });
    log(4, `still cached? ${sid}: ${have}/${info.files.length} ${have === info.files.length ? '✅' : '❌ EVICTED'} (${days} days after download)`);
  }
  if (!Object.keys(dl).length) hist.push({ ts: new Date().toISOString(), sid: '-', have: 0, total: 0, note: 'nothing downloaded yet', persisted, standalone });
  lsSet(LS.evict, hist.slice(-300));
  $('evictLog').textContent = hist.slice().reverse().map((h) => `${new Date(h.ts).toLocaleString([], { hour12: false })} ${h.sid} ${h.total ? h.have + '/' + h.total + (h.have === h.total ? ' ✅' : ' ❌') : (h.note || '')} ${h.days ? '+' + h.days + 'd' : ''} persisted=${h.persisted} ${h.standalone ? 'HS' : 'tab'}`).join('\n');
}

// ---------- 6: pick any duration (Web Audio loop + scheduled fade) ----------
// Design notes (also in README):
// - The loop file holds [0.5 s of loop tail] + [240 s loop] + [0.5 s of loop head]. We loop [0.5 s, 240.5 s) with
//   loopStart/loopEnd, so AAC priming/padding (and whether the browser honours the MP4 edit list) never touches the seam.
// - healSeam(): the 250 ms before loopEnd are blended into the identical material just before loopStart, so the jump
//   lands on contiguous decoded samples (no AAC re-encode discontinuity at the seam).
// - Fade + stop are scheduled up front on the AudioContext clock (linearRamp + source.stop(when)), not setTimeout,
//   so they fire while the page is hidden/locked as long as the audio clock is running.
// - Keep-alive A (default): a looping, practically silent <audio> element plays alongside, so iOS treats the page as
//   media playback (lock-screen controls, audio session category) and is less likely to suspend the AudioContext.
//   B: Web Audio only. C: Web Audio routed into an <audio> element via MediaStreamAudioDestinationNode.
const qs = new URLSearchParams(location.search);
const FAST = qs.get('fast') === '1';            // debug: minutes -> seconds
const UNIT = FAST ? 1 : 60, FADE_MIN = 3;
const keep = $('keep');
let ac = null, anyBuf = null, anyBufFor = null, anySrc = null, anyGain = null, anyStreamDest = null;
let any = null; // {t0, tFade, tEnd, durMin, wall0, mode, ended}
const fmtMin = (m) => { const h = Math.floor(m / 60), x = m % 60; return h ? `${h} h${x ? ' ' + x + ' min' : ''}` : `${x} min`; };
function durLabel() { const v = Number($('durSlider').value); $('durLabel').textContent = fmtMin(v) + (FAST ? ' (fast: ' + v + ' s)' : ''); }
$('durSlider').oninput = durLabel; durLabel();
if (FAST) log(6, 'FAST debug mode: 1 min = 1 s');
function ensureCtx() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  ac = new AC({ latencyHint: 'playback' });
  ac.onstatechange = () => log(6, 'AudioContext state → ' + ac.state);
  return ac;
}
function setAudioSessionPlayback() {
  try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; log(6, 'navigator.audioSession.type = playback'); } } catch (e) { log(6, 'audioSession failed: ' + e.name); }
}
function healSeam(buf, s, L, N) {
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < N; k++) { const w = (k + 1) / N; d[s + L - N + k] = d[s + L - N + k] * (1 - w) + d[s - N + k] * w; }
  }
}
async function loadLoop() {
  const f = session && session.loop; if (!f) throw new Error('no audio_loop file in this session');
  if (anyBuf && anyBufFor === url(f)) return anyBuf;
  anyBuf = null; anyBufFor = null;
  $('anyLoop').textContent = 'loading ' + f.file + '…';
  const r = await fetch(url(f)); if (!r.ok) throw new Error('loop HTTP ' + r.status);
  const ab = await r.arrayBuffer();
  const buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  const meta = (session.manifest.files && session.manifest.files[f.file]) || {};
  const sr = buf.sampleRate, s = Math.round((meta.loop_start_s ?? 0.5) * sr), L = Math.round((meta.loop_len_s ?? 240) * sr);
  if (s + L > buf.length) throw new Error(`loop file too short: ${buf.length} < ${s + L}`);
  healSeam(buf, s, L, Math.round(0.25 * sr));
  buf._loopStart = s / sr; buf._loopEnd = (s + L) / sr;
  anyBuf = buf; anyBufFor = url(f);
  $('anyLoop').textContent = `${f.file} · ${(buf.length / sr).toFixed(2)} s decoded @ ${sr} Hz · loop ${buf._loopStart.toFixed(3)}→${buf._loopEnd.toFixed(3)} s · ${(buf.length * buf.numberOfChannels * 4 / 1e6).toFixed(0)} MB RAM`;
  log(6, 'loop decoded: ' + $('anyLoop').textContent);
  return buf;
}
function anyTeardown() {
  if (anySrc) { try { anySrc.onended = null; anySrc.stop(); } catch {} try { anySrc.disconnect(); } catch {} }
  if (anyGain) try { anyGain.disconnect(); } catch {}
  anySrc = anyGain = null;
  keep.pause(); keep.removeAttribute('src'); keep.srcObject = null;
}
async function anyStart() {
  if (!session) return;
  // stop the <audio> tests so we compare like with like
  if (timerMode) cancelTimer(false); if (playing) pause('test 6 started');
  anyTeardown();
  ensureCtx(); setAudioSessionPlayback();
  const mode = $('keepMode').value;
  // unlock audio on the user gesture *before* the await chain (iOS)
  if (mode === 'silent') { keep.src = 'keepalive_10s.m4a'; keep.loop = true; keep.play().catch((e) => log(6, 'keep-alive play rejected: ' + e.name)); }
  if (ac.state !== 'running') await ac.resume().catch((e) => log(6, 'resume failed: ' + e));
  let buf; try { buf = await loadLoop(); } catch (e) { log(6, '❌ ' + e.message); $('anyResult').textContent = '❌ ' + e.message; anyTeardown(); return; }
  const durMin = Number($('durSlider').value), dur = durMin * UNIT, fade = FADE_MIN * UNIT;
  anySrc = ac.createBufferSource(); anySrc.buffer = buf; anySrc.loop = true; anySrc.loopStart = buf._loopStart; anySrc.loopEnd = buf._loopEnd;
  anyGain = ac.createGain();
  anySrc.connect(anyGain);
  if (mode === 'stream') {
    anyStreamDest = anyStreamDest || ac.createMediaStreamDestination();
    anyGain.connect(anyStreamDest); keep.srcObject = anyStreamDest.stream; keep.loop = false;
    keep.play().catch((e) => log(6, 'stream <audio> play rejected: ' + e.name));
  } else anyGain.connect(ac.destination);
  const t0 = ac.currentTime + 0.1, tFade = t0 + dur - fade, tEnd = t0 + dur;
  const g = anyGain.gain;
  g.setValueAtTime(0, t0); g.linearRampToValueAtTime(1, t0 + Math.min(1, fade / 4)); // short fade-in
  g.setValueAtTime(1, tFade); g.linearRampToValueAtTime(0, tEnd);                    // 3-min fade to silence
  anySrc.start(t0, buf._loopStart); anySrc.stop(tEnd + 0.05);
  const now = Date.now();
  any = { t0, tFade, tEnd, durMin, wall0: now, mode, ended: false, pausedMs: 0,
    fadeWall: now + (tFade - ac.currentTime) * 1000, endWall: now + (tEnd - ac.currentTime) * 1000 };
  anySrc.onended = () => anyEnded('source ended on the audio clock');
  $('anyPlan').textContent = `${fmtMin(durMin)}${FAST ? ' (fast)' : ''} · fade starts ${fmtClock(new Date(any.fadeWall))} · silent + stop ${fmtClock(new Date(any.endWall))} · keep-alive ${mode}`;
  $('anyResult').textContent = 'running…'; $('anyResult').className = '';
  log(6, `▶︎ start ${fmtMin(durMin)}${FAST ? ' FAST' : ''}, mode ${mode}; fade ${fmtClock(new Date(any.fadeWall))} → stop ${fmtClock(new Date(any.endWall))} (scheduled on audio clock)`);
  setAnyMetadata(); setHandlers();
  if (ms) ms.playbackState = 'playing';
}
function anyEnded(why) {
  if (!any || any.ended) return;
  any.ended = true;
  const late = (Date.now() - any.endWall - any.pausedMs) / 1000;
  const msg = `⏹ ended ${fmtClock()} (${why}); planned ${fmtClock(new Date(any.endWall + any.pausedMs))}, off by ${late >= 0 ? '+' : ''}${late.toFixed(1)} s${document.hidden ? ' — while HIDDEN/locked' : ''}`;
  log(6, msg); $('anyResult').textContent = msg; $('anyResult').className = Math.abs(late) <= 60 ? 'ok' : 'bad';
  keep.pause(); if (ms) ms.playbackState = 'none';
}
let anyPausedAt = 0;
async function anyPause(reason = 'button') {
  if (!any || any.ended || !ac) return;
  if (ac.state === 'running') { await ac.suspend(); anyPausedAt = Date.now(); keep.pause(); log(6, 'pause (' + reason + ') — audio clock suspended, fade moves later by the pause length'); if (ms) ms.playbackState = 'paused'; }
}
async function anyResume(reason = 'button') {
  if (!any || any.ended || !ac) return;
  if (ac.state !== 'running') {
    await ac.resume().catch((e) => log(6, 'resume failed: ' + e));
    if (anyPausedAt) { any.pausedMs += Date.now() - anyPausedAt; anyPausedAt = 0; }
    if (any.mode !== 'none' && (keep.src || keep.srcObject)) keep.play().catch(() => {});
    log(6, 'resume (' + reason + ')'); if (ms) ms.playbackState = 'playing';
  }
}
function anyStop(reason = 'button') { if (any && !any.ended) { log(6, '■ stop (' + reason + ')'); any.ended = true; $('anyResult').textContent = 'stopped by user'; } anyTeardown(); if (ms) ms.playbackState = 'none'; }
$('btnAnyStart').onclick = anyStart;
$('btnAnyPause').onclick = () => (ac && ac.state !== 'running' ? anyResume() : anyPause());
$('btnAnyStop').onclick = () => anyStop();
const anyActive = () => !!(any && !any.ended);
function setAnyMetadata() {
  if (!ms || !session) return;
  const m = session.manifest;
  const art = []; if (session.poster) art.push({ src: new URL(url(session.poster), location.href).href, sizes: '1920x1080', type: 'image/jpeg' });
  art.push({ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' });
  ms.metadata = new MediaMetadata({ title: `${m.title || session.id} · ${fmtMin(any.durMin)}`, artist: 'Loop phone test · any duration', album: 'Loop phone test', artwork: art });
}
// what happened while hidden (test 6)
let anyHid = null;
document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  if (document.hidden) { anyHid = { wall: Date.now(), ctxT: ac.currentTime, state: ac.state, active: anyActive() }; log(6, `hidden · audio clock ${ac.state}${anyActive() ? ' · gain ' + anyGain.gain.value.toFixed(3) : ''}`); }
  else if (anyHid) {
    const dt = (Date.now() - anyHid.wall) / 1000, adv = ac.currentTime - anyHid.ctxT;
    const ok = adv > dt * 0.9 || (any && any.ended);
    const msg = `while hidden ${fmtDur(dt)}: audio clock advanced ${fmtDur(adv)} · now ${ac.state}${any ? (any.ended ? ' · ENDED' : ' · gain ' + (anyGain ? anyGain.gain.value.toFixed(3) : '-')) : ''}`;
    $('anyHidden').textContent = msg + (anyHid.active ? (ok ? ' ✅' : ' ❌ suspended') : ''); $('anyHidden').className = anyHid.active ? (ok ? 'ok' : 'bad') : '';
    log(6, msg); anyHid = null;
  }
});
// ticker for test 6; also a wall-clock backstop in case 'ended' is missed
setInterval(() => {
  if (!ac || !any) { $('anyClock').textContent = '--:--'; return; }
  const t = ac.currentTime, el = Math.max(0, t - any.t0), rem = Math.max(0, any.tEnd - t);
  const sc = UNIT === 1 ? 60 : 1; // show fast-mode seconds as if minutes
  $('anyClock').textContent = any.ended ? 'done' : `${fmtDur(el * sc)} elapsed · ${fmtDur(rem * sc)} left${t >= any.tFade ? ' · fading' : ''}`;
  $('anyCtx').textContent = `${ac.state} · t=${t.toFixed(1)} s · fade at ${(any.tFade).toFixed(1)} · end at ${any.tEnd.toFixed(1)}`;
  $('anyGain').textContent = anyGain ? anyGain.gain.value.toFixed(3) : '-';
  if (!any.ended && t > any.tEnd + 1) anyEnded('audio clock passed end (backstop)');
  if (anyActive() && ms && 'setPositionState' in ms) { try { ms.setPositionState({ duration: any.tEnd - any.t0, playbackRate: 1, position: Math.min(el, any.tEnd - any.t0) }); } catch {} }
}, 500);
// debug hooks for headless verification
window.__any = () => ({ ac, any, gain: anyGain ? anyGain.gain.value : null, gainNode: anyGain, buf: anyBuf, FAST });

// ---------- checklist ----------
const CHECKS = [
  'Safari tab: audio keeps playing with screen locked (≥2 min)',
  'Safari tab: after unlock, page still playing and controls work',
  'Home Screen app: audio keeps playing with screen locked',
  'Home Screen app: audio plays again after closing and reopening the app (WebKit 295518)',
  'Home Screen app (minimal-ui manifest): audio keeps playing when locked',
  'Lock screen shows title + poster artwork',
  'Lock screen play/pause works',
  'Lock screen ±15 s seek / scrub works',
  'Lock screen next/prev works (seek handlers off)',
  'Video loop is seamless (no visible jump at the loop point)',
  'Video pauses on lock and auto-resumes on unlock',
  'Audio/video drift is acceptable',
  'Download completes; cache size and estimate shown',
  'Plays in Airplane Mode after force-quit (Safari tab)',
  'Plays in Airplane Mode (Home Screen app)',
  'persist() granted (note: tab vs Home Screen)',
  'Still cached after 1 day',
  'Still cached after 3 days',
  'Still cached after 7+ days',
  'Sleep timer: fade audible, then stops while locked',
  'All-night file loops without an audible gap or click',
  'Any duration (Safari tab): keeps playing locked 30+ min',
  'Any duration (Safari tab): fade fires while locked, stops within ~1 min of plan',
  'Any duration (Home Screen): keeps playing locked 30+ min',
  'Any duration (Home Screen): fade fires while locked, stops within ~1 min of plan',
  'Any duration: no audible gap/click at the 4-min loop seam',
  'Any duration: lock-screen pause/play works',
  'Any duration (Android Chrome): locked 30+ min and fade fires',
];
const STATES = ['☐', '✅', '❌', '➖'];
function renderChecks() {
  const st = lsGet(LS.checks, {}); const box = $('checklist'); box.innerHTML = '';
  CHECKS.forEach((txt, i) => {
    const row = document.createElement('label'); row.className = 'chk';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = STATES[st[i] || 0]; b.style.padding = '2px 8px';
    b.onclick = (e) => { e.preventDefault(); const s = lsGet(LS.checks, {}); s[i] = ((s[i] || 0) + 1) % STATES.length; lsSet(LS.checks, s); b.textContent = STATES[s[i]]; };
    const span = document.createElement('span'); span.textContent = txt;
    row.append(b, span); box.appendChild(row);
  });
}
$('notes').value = lsGet(LS.notes, ''); $('notes').oninput = (e) => lsSet(LS.notes, e.target.value);
$('btnReset').onclick = () => { if (confirm('Reset checklist?')) { lsSet(LS.checks, {}); renderChecks(); } };
$('btnCopy').onclick = async () => {
  const st = lsGet(LS.checks, {});
  const txt = [
    `Loop phone test results · ${new Date().toString()}`,
    `Mode: ${modeLabel} · iOS ${iosVer || 'n/a'}`, `UA: ${navigator.userAgent}`,
    `Session: ${session ? session.id + ' (' + session.source + ')' : '-'}`,
    `Last hidden test: ${$('hiddenRes').textContent}`,
    `Any duration: plan ${$('anyPlan').textContent} · hidden ${$('anyHidden').textContent} · result ${$('anyResult').textContent}`,
    `Cache: ${$('cacheFiles').textContent} · persisted ${$('persisted').textContent} · ${$('estimate').textContent} · served from ${$('servedFrom').textContent}`,
    '', 'Checklist (✅ pass ❌ fail ➖ n/a ☐ untested):', ...CHECKS.map((c, i) => `${STATES[st[i] || 0]} ${c}`),
    '', 'Notes:', $('notes').value || '-',
    '', 'Still-cached history (latest 20):', ...lsGet(LS.evict, []).slice(-20).map((h) => `${h.ts} ${h.sid} ${h.have}/${h.total} +${h.days || 0}d persisted=${h.persisted} ${h.standalone ? 'HS' : 'tab'}`),
    '', 'Event log (latest 60, ISO/UTC):', ...lsGet(LS.log, []).slice(-60),
  ].join('\n');
  try { await navigator.clipboard.writeText(txt); $('copyMsg').textContent = 'Copied ✓'; }
  catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); $('copyMsg').textContent = 'Copied (fallback) ✓'; }
};

// ---------- ticker ----------
setInterval(() => {
  $('elapsed').textContent = playing ? `${fmtDur((Date.now() - playStartWall) / 1000)} wall · ${fmtDur(listened)} heard` : '0:00';
  $('atime').textContent = `${fmtDur(aud.currentTime)} / ${fmtDur(aud.duration)}`;
  $('astate').textContent = `${aud.paused ? 'paused' : 'playing'} · readyState ${aud.readyState} · loop ${aud.loop}`;
  const vd = vid.duration;
  $('vstate').textContent = `${vid.paused ? 'paused' : 'playing'} · readyState ${vid.readyState} · ${vid.videoWidth}x${vid.videoHeight}`;
  $('vtime').textContent = `${vid.currentTime.toFixed(2)} s / ${isFinite(vd) ? vd.toFixed(2) : '-'} · loops ${vLoops}`;
  if (isFinite(vd) && vd > 0) {
    const am = aud.currentTime % vd; let dr = vid.currentTime - am; if (dr > vd / 2) dr -= vd; if (dr < -vd / 2) dr += vd;
    $('amod').textContent = am.toFixed(2) + ' s'; $('drift').textContent = (dr >= 0 ? '+' : '') + dr.toFixed(2) + ' s';
  }
  if (timerMode && isFinite(aud.duration)) $('countdown').textContent = fmtDur(aud.duration - aud.currentTime) + ' left';
  else if (!timerMode) $('countdown').textContent = '--:--';
}, 500);

// ---------- boot ----------
(async () => {
  log('all', `load · ${modeLabel} · online=${navigator.onLine}`);
  renderChecks();
  await registerSW();
  await loadSessions();
  await evictionCheck();
  refreshCacheStatus();
  if (ms) setHandlers();
})();
