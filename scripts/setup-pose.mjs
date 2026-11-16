import { cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../public/pose/', import.meta.url);
await mkdir(root, { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('wasm/', root), { recursive: true });
const url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const expectedHash = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const target = new URL('pose_landmarker_lite.task', root);
let bytes;
try { bytes = await readFile(target); }
catch {
  console.log('Downloading official MediaPipe Pose Landmarker Lite model (no user data)...');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error('Model response is unexpectedly small');
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Downloaded pose model checksum mismatch');
  await writeFile(new URL('pose_landmarker_lite.task.tmp', root), bytes);
  await rename(new URL('pose_landmarker_lite.task.tmp', root), target);
}
if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Pose model checksum mismatch. Remove public/pose/pose_landmarker_lite.task and retry setup.');
const manifest = { source: url, package: '@mediapipe/tasks-vision@1.2.3', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
await writeFile(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Local pose assets ready:', manifest);
