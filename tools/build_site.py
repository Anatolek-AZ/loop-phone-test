#!/usr/bin/env python3
"""Assemble the static GitHub Pages site into ./_site (same-origin media, relative paths).
Pages gets: 720p video, all-night 60 min audio, 15/30 min timers, 4-min loop, poster, a public manifest.
1080p video and 60/90 min timers go to the GitHub release (RELEASE_TAG) instead (listed in the manifest, unused by the page).
PROVENANCE.md and contact_sheet.png are not published.
usage: build_site.py <pilots_dir> <loops_dir> <out_dir> <owner/repo>"""
import html, json, os, shutil, sys
pilots, loops, out, repo = sys.argv[1:5]
RELEASE_TAG = 'media-v1'
PAGES = ['poster.jpg', 'video_720.mp4', 'audio_allnight_60m.m4a', 'audio_timer_15m.m4a', 'audio_timer_30m.m4a']
RELEASE = ['video_1080.mp4', 'audio_timer_60m.m4a', 'audio_timer_90m.m4a']
SHELL = ['index.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'manifest-minimal.webmanifest', 'keepalive_10s.m4a', 'TEST_SCRIPT.md']
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)
def put(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try: os.link(src, dst)
    except OSError: shutil.copy2(src, dst)
for f in SHELL: put(os.path.join(here, f), os.path.join(out, f))
shutil.copytree(os.path.join(here, 'icons'), os.path.join(out, 'icons'))
open(os.path.join(out, '.nojekyll'), 'w').close()
open(os.path.join(out, 'robots.txt'), 'w').write('User-agent: *\nDisallow: /\n')
# TEST_SCRIPT.html (phones show raw .md as a download on some browsers)
md = open(os.path.join(here, 'TEST_SCRIPT.md')).read()
try:
    import markdown; body = markdown.markdown(md, extensions=['tables'])
except Exception:
    body = '<pre style="white-space:pre-wrap">' + html.escape(md) + '</pre>'
open(os.path.join(out, 'TEST_SCRIPT.html'), 'w').write(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta name="robots" content="noindex,nofollow"><title>Loop phone test · test script</title>'
    '<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:760px;margin:0 auto;padding:12px 16px 60px;color:#222}'
    'code{background:#f2f2f2;padding:0 3px}li{margin:4px 0}</style>' + body)
sessions = []
for sid in sorted(os.listdir(pilots)):
    d = os.path.join(pilots, sid); mpath = os.path.join(d, 'manifest.json')
    if not os.path.isfile(mpath) or not os.path.isfile(os.path.join(loops, sid, 'audio_loop_4m.m4a')): continue
    m = json.load(open(mpath)); qc = m.get('qc', {})
    files = {}
    for f in PAGES:
        e = dict(m['files'][f]); e.update({k: qc[f][k] for k in ('duration_s',) if f in qc and k in qc[f]})
        files[f] = e; put(os.path.join(d, f), os.path.join(out, 'pilots', sid, f))
    lj = json.load(open(os.path.join(loops, sid, 'loop.json')))
    files['audio_loop_4m.m4a'] = {k: v for k, v in lj.items() if k != 'file'}
    put(os.path.join(loops, sid, 'audio_loop_4m.m4a'), os.path.join(out, 'pilots', sid, 'audio_loop_4m.m4a'))
    pub = {'session_id': sid, 'title': m.get('working_title', sid), 'note': 'throwaway phone test media',
           'files': files,
           'edit_lists': {k: v for k, v in m.get('audio_build', {}).get('edit_lists', {}).items() if k + '.m4a' in files},
           'release_assets': {f: {**m['files'][f], 'url': f'https://github.com/{repo}/releases/download/{RELEASE_TAG}/{sid}__{f}',
                                  'note': 'release asset (cross-origin, not used by the page)'} for f in RELEASE}}
    json.dump(pub, open(os.path.join(out, 'pilots', sid, 'manifest.json'), 'w'), indent=1)
    sessions.append({'id': sid, 'title': pub['title'], 'source': 'pilot', 'base': f'pilots/{sid}/'})
json.dump({'sessions': sessions}, open(os.path.join(out, 'sessions.json'), 'w'), indent=1)
tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(out) for f in fs)
big = [(os.path.join(r, f), os.path.getsize(os.path.join(r, f))) for r, _, fs in os.walk(out) for f in fs if os.path.getsize(os.path.join(r, f)) >= 100e6]
print(f'site: {len(sessions)} sessions, {tot/1e6:.1f} MB'); assert not big, big; assert tot < 1e9
