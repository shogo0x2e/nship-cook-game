#!/usr/bin/env node
// Generates files only. Never installs a CA or changes OS/browser trust settings.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node scripts/create-local-cert.mjs <Mac LAN IP or hostname> [more SAN names...] [--out <new-directory>]\nDefault output: .local-certs/\nCreates local-only CA and server certificate files. Does NOT install or trust them.');
  process.exit(args.includes('--help') ? 0 : 1);
}
let output = resolve('.local-certs');
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--out needs a new directory path');
    output = resolve(args[++i]);
  } else {
    const name = args[i];
    if (!isIP(name) && !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(name)) {
      throw new Error(`Invalid IP address or hostname: ${name}`);
    }
    names.push(name);
  }
}
if (!names.length) throw new Error('Specify the Mac LAN IP or hostname used by the devices.');
if (existsSync(output)) throw new Error(`Refusing to overwrite existing directory: ${output}. Choose a new --out directory.`);
const openssl = process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl';
execFileSync(openssl, ['version'], { stdio: 'ignore' });
process.umask(0o077);
mkdirSync(output, { mode: 0o700 });
const file = name => join(output, name);
const san = [...new Set(['localhost', '127.0.0.1', '::1', ...names])];
let dns = 0, ip = 0;
const altNames = san.map(name => `${isIP(name) ? `IP.${++ip}` : `DNS.${++dns}`} = ${name}`).join('\n');
const caConfig = `[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = ca_ext\n[dn]\nCN = Mogumogu Local Development CA\n[ca_ext]\nbasicConstraints = critical,CA:TRUE,pathlen:0\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n`;
const serverConfig = `[req]\nprompt = no\ndistinguished_name = dn\nreq_extensions = server_ext\n[dn]\nCN = ${names[0]}\n[server_ext]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @alt_names\n[alt_names]\n${altNames}\n`;
writeFileSync(file('ca.cnf'), caConfig, { flag: 'wx', mode: 0o600 });
writeFileSync(file('server.cnf'), serverConfig, { flag: 'wx', mode: 0o600 });
const run = args => execFileSync(openssl, args, { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '90', '-config', file('ca.cnf'), '-keyout', file('ca.key'), '-out', file('ca.crt')]);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-config', file('server.cnf'), '-keyout', file('server.key'), '-out', file('server.csr')]);
  run(['x509', '-req', '-in', file('server.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'), '-set_serial', `0x${randomBytes(16).toString('hex')}`, '-days', '30', '-sha256', '-extfile', file('server.cnf'), '-extensions', 'server_ext', '-out', file('server.crt')]);
  chmodSync(file('ca.key'), 0o600); chmodSync(file('server.key'), 0o600);
  run(['verify', '-CAfile', file('ca.crt'), file('server.crt')]);
  unlinkSync(file('server.csr')); unlinkSync(file('ca.cnf')); unlinkSync(file('server.cnf'));
  console.log(`Created local certificate files in ${output}\nSAN: ${san.join(', ')}\nCA: 90 days / server: 30 days.\nNo trust settings were changed. Devices must explicitly trust ca.crt before camera use.\nNever share ca.key or server.key. Use only on a trusted local network; do not publish this CA or server.`);
} catch (error) {
  console.error(`Certificate creation failed. Partial files remain in ${output}; inspect before retrying with a new directory.`);
  throw error;
}
