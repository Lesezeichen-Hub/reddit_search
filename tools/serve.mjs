// Minimaler statischer Entwicklungsserver (nur 127.0.0.1).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const port = Number(process.env.PORT || 8790);

export function startServer(listenPort = port) {
  const server = createServer(async (req, res) => {
    try {
      // Simuliert die Auslieferung durch den Lesezeichen-Hub unter /modules/<id>/.
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/modules\/\d+(?=\/)/, '');
      const path = resolve(root, `.${pathname}`);
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const file = path === root || pathname.endsWith('/') ? resolve(path, 'index.html') : path;
      if (file.includes(`${sep}node_modules${sep}`) || file.includes(`${sep}.git${sep}`)) {
        res.writeHead(404).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    }
  });
  return new Promise((done) => server.listen(listenPort, '127.0.0.1', () => done(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`Reddit Investigator: http://127.0.0.1:${port}/`);
}
