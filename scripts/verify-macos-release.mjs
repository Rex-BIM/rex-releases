// Public binary verification only. No product source, account profile or signing key is required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const [version, destination] = process.argv.slice(2);
assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Pass an exact release version');
assert.ok(destination, 'Pass an empty verification directory');
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
const output = resolve(destination), base = `https://github.com/Rex-BIM/rex-releases/releases/download/v${version}`;
await mkdir(output, { recursive: false, mode: 0o700 });
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', timeout: 120_000 });
const os = run('/usr/bin/sw_vers', ['-productVersion']).trim();
assert.ok(Number(os.split('.')[0]) >= 15, 'This release requires macOS 15 or later');
if (process.env.EXPECTED_MACOS_MAJOR) assert.equal(os.split('.')[0], process.env.EXPECTED_MACOS_MAJOR, 'The runner must actually use the requested OS');

const manifestResponse = await fetch(`${base}/release.json`, { signal: AbortSignal.timeout(60_000) });
assert.ok(manifestResponse.ok, `Release manifest: HTTP ${manifestResponse.status}`);
const text = await manifestResponse.text(); assert.ok(Buffer.byteLength(text) < 128 * 1024);
const release = JSON.parse(text);
assert.equal(release.version, version); assert.equal(release.architecture, 'arm64');
assert.equal(release.minimumOS, '15.0');
assert.equal(release.installer, `Rex-${version}-macOS-arm64.zip`);
assert.match(release.sourceCommit, /^[a-f0-9]{40}$/); assert.match(release.sha256, /^[a-f0-9]{64}$/);
assert.ok(Number.isSafeInteger(release.bytes) && release.bytes > 1_000_000 && release.bytes < 2 ** 31);
await writeFile(join(output, 'release.json'), text);
const response = await fetch(`${base}/${release.installer}`, { signal: AbortSignal.timeout(10 * 60_000) });
assert.ok(response.ok && response.body, `ZIP download: HTTP ${response.status}`);
const digest = createHash('sha256'); let bytes = 0;
const count = new Transform({ transform(chunk, _encoding, done) {
  bytes += chunk.length;
  if (bytes > release.bytes) return done(new Error('The ZIP exceeds the pinned release size'));
  digest.update(chunk); done(null, chunk);
} });
const zip = join(output, release.installer);
await pipeline(Readable.fromWeb(response.body), count, createWriteStream(zip, { flags: 'wx' }));
assert.equal(bytes, release.bytes); assert.equal(digest.digest('hex'), release.sha256);
run('/usr/bin/ditto', ['-x', '-k', zip, join(output, 'expanded')]);
const app = join(output, 'expanded', 'Rex Architect.app');
const key = name => run('/usr/bin/plutil', ['-extract', name, 'raw', '-o', '-', join(app, 'Contents/Info.plist')]).trim();
assert.equal(key('CFBundleIdentifier'), 'studio.rex.architect.development');
assert.equal(key('CFBundleShortVersionString'), version); assert.equal(key('LSMinimumSystemVersion'), '15.0');
const build = JSON.parse(await readFile(join(app, 'Contents/Resources/app/build-info.json'), 'utf8'));
assert.equal(build.version, version); assert.match(build.commit, /^[a-f0-9]{7,40}$/);
assert.ok(release.sourceCommit.startsWith(build.commit));
assert.equal(build.repository, undefined, 'No build-machine path ships in the app');
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
// codesign displays signature metadata on stderr, so query it without exposing any keychain.
const { spawnSync } = await import('node:child_process');
const displayed = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
assert.equal(displayed.status, 0);
assert.match(displayed.stderr, /^TeamIdentifier=U928CCRQ2N$/m);
assert.match(displayed.stderr, /flags=.*runtime/); assert.match(displayed.stderr, /^Timestamp=/m);
run('/usr/bin/xcrun', ['stapler', 'validate', app]);
run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
await writeFile(join(output, 'package-verification.json'), JSON.stringify({
  passed: true, os, architecture: process.arch, version, sourceCommit: release.sourceCommit,
  sha256: release.sha256, bytes, strictSignature: true, developerIdTeam: 'U928CCRQ2N',
  hardenedRuntime: true, secureTimestamp: true, stapledTicket: true, gatekeeper: true,
}, null, 2) + '\n');
console.log(`Verified Rex ${version} ZIP, provenance, signature and notarization on macOS ${os}.`);
