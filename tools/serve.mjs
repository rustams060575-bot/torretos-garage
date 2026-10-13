// Minimal static server with HTTP Range support (video seeking needs 206 responses).
//   node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
};

export function startServer(port = 5173, { quiet = false } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(ROOT, rel));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        let start = range[1] ? +range[1] : st.size - +range[2];
        let end = range[1] && range[2] ? +range[2] : st.size - 1;
        if (!range[1]) end = st.size - 1;
        if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end(); return; }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, 'content-length': st.size });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
      }
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Torreto's Garage → http://localhost:${server.address().port}`);
    resolve(server);
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  startServer(+process.argv[2] || 5173);
}
