// Exercises only the public app and an original, synthetic DXF. No product source or real account is needed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchMacApp } from './launch-macos-app.mjs';

const appPath = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? 'verification-output');
assert.ok(appPath.endsWith('.app')); assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(join(tmpdir(), 'rex-public-smoke-')), home = join(root, 'home'), testHome = join(root, 'desktop');
await fs.mkdir(home); const resources = join(appPath, 'Contents/Resources');
const run = (program, args, env = {}) => execFileSync(program, args, { encoding: 'utf8', timeout: 60_000,
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, TMPDIR: root, ...env } });
const report = { passed: false, os: run('/usr/bin/sw_vers', ['-productVersion']).trim(), architecture: process.arch,
  realAccount: false, rendering: 'software WebGL in the hosted test VM', rendererErrors: [] };
if (process.env.EXPECTED_MACOS_MAJOR) assert.equal(report.os.split('.')[0], process.env.EXPECTED_MACOS_MAJOR);
let electron, server, closing = false;
report.teardownNetworkCancellations = [];
try {
  console.log('phase: bundled tools');
  // Cold-start the self-contained .NET runtime and parse one original line in a minimal drawing.
  const dxf = join(root, 'one-line.dxf');
  await fs.writeFile(dxf, ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1027','0','ENDSEC',
    '0','SECTION','2','ENTITIES','0','LINE','8','0','10','0.0','20','0.0','30','0.0','11','1000.0','21','0.0','31','0.0',
    '0','ENDSEC','0','EOF',''].join('\n'));
  const drawing = JSON.parse(run(join(resources, 'bin/rex-dwg2dxf'), ['--stats', dxf], { DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(root, 'dotnet') }));
  assert.equal(drawing.entities, 1); assert.equal(drawing.byType.LINE, 1); report.drawingRuntime = true;
  const git = join(resources, 'git/bin/git'), repo = join(root, 'history');
  assert.match(run(git, ['--version']), /^git version /);
  run(git, ['init', '-q', repo], { GIT_CONFIG_NOSYSTEM: '1' });
  await fs.writeFile(join(repo, 'state.txt'), 'Rex package verification\n');
  const history = args => run(git, ['-C', repo, ...args], { GIT_CONFIG_NOSYSTEM: '1' });
  history(['add', 'state.txt']);
  history(['-c','user.name=Package Verification','-c','user.email=verification@example.test','commit','--no-gpg-sign','-qm','Package smoke']);
  history(['repack','-ad']); history(['fsck','--strict']);
  assert.equal(history(['show','HEAD:state.txt']), 'Rex package verification\n'); report.bundledGitHistory = true;

  // The app's ordinary account interface, with a synthetic account and empty settings on loopback.
  const user = { id: 'usr_package_verification', email: 'verification@example.test', name: 'Package Verification' };
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const json = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (path === '/auth/health') return json(200, { signIn: true, providers: { google: true, email: true }, signUp: 'open' });
    if (path === '/auth/session') return json(200, { user });
    if (path === '/user/settings') return json(200, { settings: {} });
    if (path === '/user/docs/architect/workspaces') return json(200, { data: { v: 1, list: [] } });
    if (path.startsWith('/ai/gateway/codex')) return json(401, { error: 'Synthetic test account only.' });
    return json(404, { error: 'Not part of this package smoke.' });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const auth = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(join(home, '.rex-architect.env'), `REX_AUTH_URL=${auth}\n`);
  await fs.writeFile(join(home, '.rex-architect-session.json'), JSON.stringify({ server: auth, token: 'rexs_'+'e'.repeat(43), user, savedAt: new Date().toISOString() }));
  const profile = join(testHome, 'user-data'), project = join(root, 'Office');
  await fs.mkdir(profile, { recursive: true });
  await fs.cp(join(resources, 'app/samples/architect-office'), project, { recursive: true });
  const at = new Date().toISOString();
  await fs.writeFile(join(profile, 'first-run.json'), JSON.stringify({ version: 1, stage: 'done', startedAt: at, doneAt: at, reason: 'existing' }));
  console.log('phase: launch app');
  electron = await launchMacApp({ executablePath: join(appPath, 'Contents/MacOS/Rex Architect'),
    args: ['--use-mock-keychain', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--rex-test-home=${testHome}`, `--project=${project}`],
    env: { HOME: home, USER: process.env.USER ?? 'runner', TMPDIR: root, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 60_000 });
  console.log('phase: renderer connected');
  const page = await electron.firstWindow();
  await page.bringToFront();
  console.log('phase: waiting for model');
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (closing && /^Failed to load resource: net::ERR_(?:ABORTED|BLOCKED_BY_CLIENT|CONNECTION_REFUSED)$/.test(text))
      report.teardownNetworkCancellations.push({ text, url: message.location().url });
    else report.rendererErrors.push(text);
  });
  const viewport = page.locator('[data-testid="viewport"]:visible');
  await viewport.waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="viewport"]')].some(element => /^\d+$/.test(element.getAttribute('data-model-revision') ?? '')), undefined, { timeout: 90_000 });
  const state = await page.evaluate(async () => (await fetch('/api/project')).json());
  assert.equal(state.analysis.ok, true, 'The bundled compiler must compile its sample'); report.modelCompiled = true;
  const default3d = page.getByRole('button', { name: 'Default 3D view', exact: true });
  if (!(await default3d.isVisible())) await page.getByRole('button', { name: 'Quick access', exact: true }).click();
  await default3d.click();
  await page.getByTestId('architect-view-tab-v:3d').waitFor({ state: 'visible' });
  const canvas = page.locator('[data-testid="viewport"]:visible canvas').first();
  await canvas.waitFor({ state: 'visible' });
  assert.equal(await canvas.evaluate(element => !!element.getContext('webgl2')), true, 'A real WebGL2 context must exist');
  console.log('phase: rendering');
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: join(output, 'sample-model.png') });
  assert.deepEqual(report.rendererErrors, []); report.webgl = true; report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  console.log('phase: quitting');
  closing = true;
  if (electron) {
    try { await electron.close(); report.cleanQuit = true; }
    catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; }
  }
  console.log('phase: closing fixture server');
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (report.rendererErrors.length) { report.passed = false; report.error ??= 'Renderer errors occurred'; process.exitCode = 1; }
  await fs.writeFile(join(output, 'runtime-verification.json'), JSON.stringify(report, null, 2)+'\n');
  await fs.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
