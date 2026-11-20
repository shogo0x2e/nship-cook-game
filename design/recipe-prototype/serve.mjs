import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowedRoots = ['design/recipe-prototype', 'public/avatar', 'public/experience', 'public/pose', 'src', 'dist', 'node_modules/nanoid'].map(folder => path.join(root, folder) + path.sep);
const port = Number(process.env.RECIPE_PREVIEW_PORT || 8793);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.wasm':'application/wasm', '.task':'application/octet-stream', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.writeHead(302, { Location: '/design/recipe-prototype/' });
      return response.end();
    }
    const runtimeAsset = pathname === '/camera-runtime.js' || pathname.startsWith('/assets/');
    if (runtimeAsset) pathname = '/dist'+pathname;
    if (pathname.startsWith('/pose/')) pathname = '/public'+pathname;
    if (pathname.startsWith('/avatar/')) pathname = '/public'+pathname;
    if (pathname.startsWith('/experience/')) pathname = '/public'+pathname;
    if (!['/design/recipe-prototype/', '/public/avatar/', '/public/experience/', '/public/pose/', '/dist/assets/', '/node_modules/nanoid/'].some(prefix => pathname.startsWith(prefix)) && pathname !== '/src/experience-data.json' && pathname !== '/src/experience-game.css' && pathname !== '/dist/camera-runtime.js') {
      response.writeHead(404);
      return response.end('Not found');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(root, `.${pathname}`);
    if (!allowedRoots.some(folder => target.startsWith(folder))) throw new Error('Invalid path');
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Recipe prototype: http://127.0.0.1:${port}/design/recipe-prototype/\n`));
