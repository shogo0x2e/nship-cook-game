#!/usr/bin/env python3
"""Run in hosted CI: verify the account image, then export a public release."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def verify_image(image, revision):
    name = 'cookgame-ci-' + uuid.uuid4().hex[:12]
    try:
        run('docker', 'run', '-d', '--name', name, '--init', '--read-only',
            '--user', '1000:1000', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '384m',
            '--cpus', '0.5', '--pids-limit', '64',
            '--tmpfs', '/tmp:size=16m,noexec,nosuid',
            '--tmpfs', '/data:uid=1000,gid=1000,mode=0700,size=32m',
            '-e', 'DATA_DIR=/data', '-e', 'ALLOWED_ORIGINS=https://cookgame.shogo0x2e.com',
            '-p', '127.0.0.1::8787', image)
        port = run('docker', 'port', name, '8787/tcp').rsplit(':', 1)[1]
        base = 'http://127.0.0.1:' + port
        for _ in range(45):
            try:
                with urllib.request.urlopen(urllib.request.Request(base + '/api/version', headers={'Host': 'localhost:8787'}), timeout=2) as response:
                    version = json.load(response)
                assert version == {'revision': revision, 'authentication': 'family-account-v1'}, version
                break
            except (OSError, ValueError):
                time.sleep(1)
        else:
            raise RuntimeError('Account image did not become ready')
        try:
            urllib.request.urlopen(urllib.request.Request(base + '/api/auth/me', headers={'Host': 'localhost:8787'}), timeout=3)
        except urllib.error.HTTPError as error:
            assert error.code == 401
        else:
            raise RuntimeError('Unauthenticated account access was accepted')
        # The production build must contain both entry points and all generated avatar sprites.
        for path in ['/', '/poc.html', '/avatar/background.png', '/avatar/body.png',
                     '/avatar/sleeve.png', '/avatar/hand.png']:
            request = urllib.request.Request(base + path, headers={'Host': 'localhost:8787'})
            with urllib.request.urlopen(request, timeout=5) as response:
                data = response.read()
                assert response.status == 200 and data, path
                if path.endswith('.png'):
                    assert response.headers['Content-Type'] == 'image/png', path
                    assert data.startswith(b'\x89PNG\r\n\x1a\n'), path
                else:
                    assert b'type="module"' in data, path
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL)


def main():
    revision = os.environ['GITHUB_SHA']
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    assert os.environ['GITHUB_REPOSITORY'] == 'shogo0x2e/nship-cook-game'
    assert os.environ['GITHUB_REF'] == 'refs/heads/production'
    image = 'nship-cook-game:production-' + revision
    inspect = json.loads(run('docker', 'image', 'inspect', image))[0]
    assert inspect['Architecture'] == 'amd64' and inspect['Os'] == 'linux'
    assert inspect['Config']['Labels']['org.opencontainers.image.revision'] == revision
    assert inspect['Config']['User'] in ('node', '1000', '1000:1000')
    verify_image(image, revision)
    folder = Path('release')
    folder.mkdir(exist_ok=False)
    archive = folder / 'image.tar.gz'
    with archive.open('wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as compressed:
            process = subprocess.Popen(['docker', 'image', 'save', image], stdout=subprocess.PIPE)
            try:
                while chunk := process.stdout.read(1024 * 1024):
                    compressed.write(chunk)
            finally:
                process.stdout.close()
            if process.wait() != 0:
                raise RuntimeError('Docker export failed')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest = {
        'schema': 1, 'git_sha': revision, 'platform': 'linux/amd64',
        'image': image, 'image_id': inspect['Id'],
        'archive': 'image.tar.gz', 'archive_bytes': archive.stat().st_size,
        'archive_sha256': digest, 'repository_id': 1459657365,
        'workflow_run_id': int(os.environ['GITHUB_RUN_ID']),
        'authentication': 'family-account-v1',
    }
    (folder / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Account image verified; release archive and SHA-256 manifest prepared')


if __name__ == '__main__':
    main()
