import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB_ENTRY = '/apps/web/index.html';
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startApi() {
  const child = spawn('node', ['services/api/src/server.js'], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  return child;
}

function startWeb() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = url.pathname;
      if (pathname === '/') {
        res.writeHead(302, { Location: '/apps/web/' });
        res.end();
        return;
      }
      if (pathname === '/apps/web/') {
        pathname = WEB_ENTRY;
      } else if (pathname.endsWith('/')) {
        pathname = pathname + 'index.html';
      }
      const safePath = resolve(ROOT, '.' + pathname);
      if (!safePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const fileStats = await stat(safePath);
      if (fileStats.isDirectory()) {
        res.writeHead(301, { Location: WEB_ENTRY });
        res.end();
        return;
      }
      const data = await readFile(safePath);
      const contentType = contentTypes[extname(safePath)] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`Web UI running at http://localhost:${WEB_PORT}`);
  });

  return server;
}

const apiProcess = startApi();
const webServer = startWeb();

function shutdown() {
  if (apiProcess) apiProcess.kill('SIGINT');
  if (webServer) webServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
