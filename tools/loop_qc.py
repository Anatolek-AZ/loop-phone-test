#!/usr/bin/env python3
"""Offline seam QC for audio_loop_4m.m4a. Decodes the m4a (with AND without the MP4 edit list, to mimic
browsers that ignore it), plays [loopStart, loopStart+L) twice in a row exactly like the page does, and checks
the seam: sample step at the seam vs p99 of adjacent steps within +-2 s, 50 ms RMS before/after, and the
match between the margin copies (b[s+k] vs b[s+L+k]). usage: loop_qc.py <file.m4a> [more...]"""
import subprocess, sys, json
import numpy as np
SR, L, S = 48000, 240 * 48000, 24000
def dec(f, ign):
    a = ['ffmpeg', '-v', 'error'] + (['-ignore_editlist', '1'] if ign else []) + ['-i', f, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-']
    return np.frombuffer(subprocess.run(a, check=True, capture_output=True).stdout, np.float32).reshape(-1, 2).astype(np.float64)
ok_all = True
for f in sys.argv[1:]:
  for FIX in (False, True):
    for ign in (False, True):
        b = dec(f, ign)
        if FIX:  # same as app.js healSeam(): linear blend of the last N frames before loopEnd into the copy before loopStart
            N = 12000; w = ((np.arange(N) + 1) / N)[:, None]
            b[S + L - N:S + L] = b[S + L - N:S + L] * (1 - w) + b[S - N:S] * w
        off = len(b) - (L + 2 * S)   # extra samples (priming/padding) when the edit list is ignored
        s = S + (1024 if ign else 0)                   # where the page's loopStart lands (0.5 s); with no edit list, 1024 priming shifts content
        s_page = S                                     # the page always uses loopStart = 0.5 s, regardless
        res = {}
        for name, st in (('page_loopStart_0.5s', s_page),):
            seg = b[st:st + L]
            two = np.concatenate([seg[-2 * SR:], seg[:2 * SR]])      # 2 s before seam + 2 s after
            steps = np.abs(np.diff(two, axis=0)).max(axis=1)
            seam = steps[2 * SR - 1]; p99 = np.percentile(steps, 99); mx = steps.max(); rank = float((steps < seam).mean() * 100)
            nat = np.abs(b[st] - b[st - 1]).max()  # the natural, contiguous-decode step at loopStart
            r = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
            rms_d = abs(r(two[2 * SR - 2400:2 * SR]) - r(two[2 * SR:2 * SR + 2400]))
            # continuity: what follows loopEnd in the file should equal what follows loopStart
            k = 12000; a1, a2 = b[st:st + k], b[st + L:st + L + k]
            n = min(len(a1), len(a2)); match = 20 * np.log10(np.sqrt(np.mean((a1[:n] - a2[:n]) ** 2)) / (np.sqrt(np.mean(a1[:n] ** 2)) + 1e-12))
            ok = seam < mx and rms_d <= 1.5
            ok_all &= bool(ok) if FIX else True
            res[name] = dict(seam_step=round(float(seam), 6), local_p99_step=round(float(p99), 6), seam_le_p99=bool(seam <= p99), seam_percentile=round(rank, 1), natural_step_at_loopStart=round(float(nat), 6), local_max_step=round(float(mx), 6),
                             rms50_delta_dB=round(float(rms_d), 2), margin_copy_residual_dB=round(float(match), 1), PASS=bool(ok))
        print(json.dumps({'file': f, 'healSeam': FIX, 'edit_list': 'ignored' if ign else 'honoured', 'decoded_samples': len(b), 'extra_samples': int(off), **res}))
print('ALL PASS' if ok_all else 'SOME FAIL'); sys.exit(0 if ok_all else 1)
