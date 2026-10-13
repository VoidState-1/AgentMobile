import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('work/prototype-export');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = path.resolve(root, '.' + relative);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Invalid path');
    if (target === root) target = path.join(root, 'index.html');
    try { await fs.access(target); } catch { target = path.join(root, 'index.html'); }
    const content = await fs.readFile(target);
    response.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
server.listen(4180, '127.0.0.1', () => process.stdout.write('Prototype: http://127.0.0.1:4180\n'));
