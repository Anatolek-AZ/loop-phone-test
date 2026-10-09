// Tiny static server with HTTP Range (206) for local checks of ./_site, served under /loop-phone-test/ like Pages.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(process.argv[2] || '_site'), port = Number(process.argv[3] || 8790), prefix = '/loop-phone-test';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(prefix + '/')) { res.writeHead(404); return res.end(); }
  p = p.slice(prefix.length); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, path.normalize(p)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, h = { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) { const s = m[1] ? +m[1] : size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 }); return fs.createReadStream(f, { start: s, end: e }).pipe(res); }
  res.writeHead(200, { ...h, 'Content-Length': size }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', root, 'on', port));
