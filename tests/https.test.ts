import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import { createSessionServer } from '../server/server.ts';

test('local certificates validate SAN and HTTPS API without changing any trust store', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'mogumogu-tls-'));
  const directory = join(temp, 'certs');
  const script = new URL('../scripts/create-local-cert.mjs', import.meta.url);
  let app: Awaited<ReturnType<typeof createSessionServer>> | undefined;
  try {
    execFileSync(process.execPath, [script.pathname, '127.0.0.1', 'cook.local', '--out', directory], { stdio: 'pipe' });
    assert.equal((await stat(join(directory, 'ca.key'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'server.key'))).mode & 0o777, 0o600);
    assert.throws(() => execFileSync(process.execPath, [script.pathname, '127.0.0.1', '--out', directory], { stdio: 'pipe' }), /Refusing to overwrite/);
    const ca = await readFile(join(directory, 'ca.crt'));
    app = await createSessionServer({ port: 0, tlsCert: join(directory, 'server.crt'), tlsKey: join(directory, 'server.key') });
    await app.listen();
    const port = (app.server.address() as { port: number }).port;
    const base = `https://127.0.0.1:${port}`;
    function call(path: string, data?: unknown, trust = true, servername?: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = https.request(base + path, { ca: trust ? ca : undefined, servername,
          method: data ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' } }, res => {
          let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        });
        req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
      });
    }
    const created = await call('/api/rooms', { excluded: [], allergens: [] });
    assert.equal(created.status, 201);
    const adult = JSON.parse(created.body) as { code: string };
    assert.equal((await call('/api/join', { code: adult.code })).status, 200);
    await assert.rejects(call('/api/rooms', undefined, false));
    await assert.rejects(call('/', undefined, true, 'wrong-host.example'), /not in the cert|Hostname\/IP/);
  } finally {
    if (app) { app.server.closeAllConnections(); await new Promise<void>(resolve => app!.server.close(() => resolve())); }
    await rm(temp, { recursive: true, force: true });
  }
});
