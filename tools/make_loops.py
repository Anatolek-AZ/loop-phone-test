#!/usr/bin/env python3
"""Build a ~4-min seamless loop (2 s equal-power crossfade baked in) from the first 4 min of each
pilot's audio_allnight_60m.m4a, and encode it as AAC m4a with a 0.5 s margin of the loop's own audio
on BOTH sides. The page loops [margin, margin+L) via loopStart/loopEnd, so encoder priming/padding
(and whether the browser honours the MP4 edit list) never lands on the seam.
usage: make_loops.py <pilots_dir> <out_dir>"""
import json, os, subprocess, sys
import numpy as np
SR, L_S, XF_S, M_S = 48000, 240.0, 2.0, 0.5
L, XF, M = int(SR * L_S), int(SR * XF_S), int(SR * M_S)
pilots, out = sys.argv[1], sys.argv[2]
for sid in sorted(os.listdir(pilots)):
    src = os.path.join(pilots, sid, 'audio_allnight_60m.m4a')
    if not os.path.isfile(src): continue
    # ffmpeg honours the MP4 edit list by default, so sample 0 here == first audible sample
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-t', str(L_S + XF_S + 1), '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    assert len(x) >= L + XF, len(x)
    t = (np.arange(XF) + 0.5) / XF
    fin, fout = np.sin(t * np.pi / 2)[:, None], np.cos(t * np.pi / 2)[:, None]
    loop = x[:L].copy()
    loop[:XF] = x[:XF] * fin + x[L:L + XF] * fout          # loop[L-1] -> loop[0] == x[L-1] -> ~x[L]
    body = np.concatenate([loop[-M:], loop, loop[:M]]).astype(np.float32)
    os.makedirs(os.path.join(out, sid), exist_ok=True)
    np.save(os.path.join(out, sid, 'loop_ref.npy'), loop.astype(np.float32))  # local QC only, not published
    dst = os.path.join(out, sid, 'audio_loop_4m.m4a')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dst], input=body.tobytes(), check=True)
    meta = {'file': 'audio_loop_4m.m4a', 'role': 'audio_loop', 'sample_rate': SR, 'loop_start_s': M_S, 'loop_len_s': L_S,
            'margin_s': M_S, 'crossfade_s': XF_S, 'source': 'first 240 s of audio_allnight_60m.m4a (edit list honoured)',
            'size_bytes': os.path.getsize(dst)}
    json.dump(meta, open(os.path.join(out, sid, 'loop.json'), 'w'), indent=1)
    print(sid, meta)
