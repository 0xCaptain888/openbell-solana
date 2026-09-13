import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'site');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^\.\.(\/|\\)/, '');
  try {
    const body = await readFile(join(root, requested));
    res.writeHead(200, { 'Content-Type': types[extname(requested)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
server.listen(4173, '0.0.0.0', () => console.log('OpenBell demo: http://localhost:4173'));
