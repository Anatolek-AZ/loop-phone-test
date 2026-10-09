#!/usr/bin/env python3
"""Generate placeholder session media in the pilot layout (shorter durations).
Output: media/placeholder-01/  (gitignored). Code-synthesized only; owned."""
import json, os, subprocess, sys, wave, hashlib, datetime
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SID = "placeholder-01"
OUT = os.path.join(ROOT, "media", SID)
TMP = os.path.join(OUT, "_tmp")
os.makedirs(TMP, exist_ok=True)
SR = 48000
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LOOP_S = 24          # video loop length
BED_S = 300          # all-night placeholder (5 min)
TIMERS = [1, 2, 3, 5]  # minutes
FADE_S = 30

def run(cmd):
    print("+", " ".join(cmd)[:200]); subprocess.run(cmd, check=True)

def probe_dur(p):
    r = subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",p],capture_output=True,text=True)
    return round(float(r.stdout.strip()), 3)

# ---------- audio: loop-safe pink/brown noise + gentle tone ----------
rng = np.random.default_rng(7)
n = BED_S * SR
xf = 3 * SR  # crossfade length for loop-safety
def colored(nsamp, kind):
    w = rng.standard_normal(nsamp + xf)
    f = np.fft.rfft(w)
    freqs = np.fft.rfftfreq(len(w), 1/SR); freqs[0] = freqs[1]
    f = f / (freqs ** (0.5 if kind == "pink" else 1.0))
    f[freqs < 25] *= 0.1
    f[freqs > 6000] *= 0.3
    x = np.fft.irfft(f, len(w))
    x /= np.max(np.abs(x))
    # loop-safe: crossfade the extra tail into the head (equal power)
    t = np.linspace(0, np.pi/2, xf)
    head = x[:xf] * np.sin(t) + x[nsamp:nsamp+xf] * np.cos(t)
    y = x[:nsamp].copy(); y[:xf] = head
    return y
L = 0.6*colored(n, "pink") + 0.4*colored(n, "brown")
R = 0.6*colored(n, "pink") + 0.4*colored(n, "brown")
tt = np.arange(n) / SR
# tones with integer cycles over BED_S so the loop point is continuous
def tone(freq, amp, lfo_cycles):
    f = round(freq * BED_S) / BED_S
    lfo = 0.5 + 0.5*np.sin(2*np.pi*lfo_cycles*tt/BED_S)
    return amp * lfo * np.sin(2*np.pi*f*tt)
tone_mix = tone(174, 0.18, 20) + tone(261.6, 0.08, 13) + tone(130.8, 0.10, 7)
# soft bell every 15 s so a listener can tell playback is still alive while locked
bell = np.zeros(n)
for start in range(0, BED_S, 15):
    s = start*SR; ln = 4*SR
    env = np.exp(-np.arange(ln)/SR*1.5)
    bf = round(523.25*BED_S)/BED_S
    bell[s:s+ln] += 0.12*env*np.sin(2*np.pi*bf*np.arange(ln)/SR)
L = 0.5*L + tone_mix + bell; R = 0.5*R + tone_mix + bell
st = np.stack([L, R], 1); st /= np.max(np.abs(st)) * 1.05
pcm = (st * 32767).astype(np.int16)
raw = os.path.join(TMP, "bed_raw.wav")
with wave.open(raw, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# measure loudness, then apply a linear gain to hit -26 LUFS (TP guarded by alimiter at -2 dBFS)
r = subprocess.run(["ffmpeg","-hide_banner","-i",raw,"-af","loudnorm=I=-26:TP=-2:print_format=json","-f","null","-"],capture_output=True,text=True)
js = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}")+1])
gain = -26.0 - float(js["input_i"])
norm = os.path.join(TMP, "bed_norm.wav")
run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",raw,"-af",f"volume={gain:.2f}dB,alimiter=limit=0.79:level=false","-c:a","pcm_s16le",norm])

def aac(src, dst, af=None, extra_in=None):
    cmd = ["ffmpeg","-y","-hide_banner","-loglevel","error"] + (extra_in or []) + ["-i",src]
    if af: cmd += ["-af", af]
    cmd += ["-c:a","aac","-b:a","128k","-ar","48000","-ac","2","-movflags","+faststart",dst]
    run(cmd)

files = []
aac(norm, os.path.join(OUT, "audio_allnight_5m.m4a"))
for m in TIMERS:
    d = m*60
    aac(norm, os.path.join(OUT, f"audio_timer_{m}m.m4a"),
        af=f"atrim=0:{d},afade=t=in:d=2,afade=t=out:st={d-FADE_S}:d={FADE_S}",
        extra_in=["-stream_loop","-1"])

# ---------- video: 24 s seamless abstract loop, no audio ----------
# static base gradient image + periodic hue rotation + blobs on closed circular paths
H, W = 1080, 1920
yy, xx = np.mgrid[0:H, 0:W]
rr = np.hypot((xx-W/2)/W, (yy-H/2)/H)
base = np.stack([60+90*np.exp(-rr*3), 30+60*np.exp(-rr*4), 80+120*np.exp(-rr*2.5)], -1).clip(0,255).astype(np.uint8)
def blob(sz, rgb):
    g = np.mgrid[0:sz, 0:sz]; d = np.hypot(g[0]-sz/2, g[1]-sz/2)/(sz/2)
    a = (np.clip(1-d, 0, 1)**2*200).astype(np.uint8)
    img = np.zeros((sz, sz, 4), np.uint8); img[..., :3] = rgb; img[..., 3] = a
    return img
def save_raw(img, path, fmt):
    open(path+".raw","wb").write(img.tobytes())
    run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt",fmt,"-s",f"{img.shape[1]}x{img.shape[0]}","-i",path+".raw",path])
save_raw(base, os.path.join(TMP,"base.png"), "rgb24")
save_raw(blob(500,(255,200,150)), os.path.join(TMP,"b1.png"), "rgba")
save_raw(blob(360,(150,220,255)), os.path.join(TMP,"b2.png"), "rgba")
P = LOOP_S; w = f"2*PI*t/{P}"
fc = (f"[0:v]hue=h=360*t/{P}:s=1.2[bg];"
      f"[bg][1:v]overlay=x='(W-w)/2+520*cos({w})':y='(H-h)/2+260*sin(2*{w})'[o1];"
      f"[o1][2:v]overlay=x='(W-w)/2+600*cos({w}+PI)':y='(H-h)/2+300*sin({w}+PI)'[o2];"
      f"[o2]drawtext=fontfile={FONT}:text='LOOP PHONE TEST · PLACEHOLDER':x=(w-tw)/2:y=h-120:fontsize=40:fontcolor=white@0.55,"
      f"drawtext=fontfile={FONT}:text='loop %{{eif\\:mod(n\\,{P*30})/30\\:d\\:2}}s / {P}s':x=(w-tw)/2:y=h-70:fontsize=34:fontcolor=white@0.55,format=yuv420p[v]")
v1080 = os.path.join(OUT, "video_1080.mp4")
run(["ffmpeg","-y","-hide_banner","-loglevel","error","-loop","1","-framerate","30","-i",os.path.join(TMP,"base.png"),
     "-loop","1","-framerate","30","-i",os.path.join(TMP,"b1.png"),"-loop","1","-framerate","30","-i",os.path.join(TMP,"b2.png"),
     "-filter_complex",fc,"-map","[v]","-t",str(P),"-r","30","-c:v","libx264","-profile:v","high","-pix_fmt","yuv420p",
     "-preset","medium","-crf","24","-g","60","-an","-movflags","+faststart",v1080])
run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",v1080,"-vf","scale=1280:720:flags=lanczos","-c:v","libx264","-profile:v","high",
     "-pix_fmt","yuv420p","-crf","25","-g","60","-an","-movflags","+faststart",os.path.join(OUT,"video_720.mp4")])
run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",v1080,"-frames:v","1","-q:v","3",os.path.join(OUT,"poster.jpg")])

# ---------- manifest + provenance ----------
for fn in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, fn)
    if not os.path.isfile(p) or fn in ("manifest.json","PROVENANCE.md"): continue
    e = {"file": fn, "bytes": os.path.getsize(p), "sha256": hashlib.sha256(open(p,"rb").read()).hexdigest()}
    if fn.endswith((".mp4",".m4a")): e["duration_s"] = probe_dur(p)
    if fn.startswith("video_"): e.update(role="video", height=int(fn.split("_")[1].split(".")[0]), loop=True, has_audio=False)
    elif fn.startswith("audio_allnight"): e.update(role="audio_allnight", loop=True)
    elif fn.startswith("audio_timer_"): e.update(role="audio_timer", timer_min=int(fn.split("_")[2].rstrip("m.4a")), fade_s=FADE_S)
    elif fn == "poster.jpg": e.update(role="poster", width=1920, height=1080)
    files.append(e)
manifest = {"session_id": SID, "title": "Placeholder 01", "world": "Test", "artist": "Loop test (placeholder)",
            "placeholder": True, "loudness_lufs": -26, "true_peak_dbfs_max": -2,
            "created": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "files": files}
json.dump(manifest, open(os.path.join(OUT,"manifest.json"),"w"), indent=2)
open(os.path.join(OUT,"PROVENANCE.md"),"w").write(f"""# PROVENANCE: {SID}
Placeholder media for the loop phone-test page. NOT a pilot, not for release.
- Audio: synthesized in Python/numpy (pink+brown noise, sine tones, soft 523 Hz bell every 15 s), normalized to ~-26 LUFS, limiter at -2 dBFS, AAC-LC 128k 48 kHz stereo. Loop-safe via 3 s equal-power tail→head crossfade and integer-cycle tones.
- Timer files: the 5 min bed trimmed/looped to 1/2/3/5 min with a {FADE_S} s baked fade-out.
- Video: ffmpeg filter graph (static numpy gradient, periodic hue rotation, two blobs on closed paths), {LOOP_S} s seamless loop, H.264 High yuv420p 30 fps faststart, no audio track.
- AI tools used: none. Third-party assets: none (DejaVu Sans font for on-screen label).
- Generator: tools/make_placeholders.py
""")
import shutil; shutil.rmtree(TMP)
print("done", OUT)
