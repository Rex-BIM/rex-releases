// Launches the shipped app through Chromium CDP. It never enables the main-process Node inspector.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

async function within(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export async function launchMacApp({ executablePath, args = [], env, timeout = 60_000 }) {
  const child = spawn(executablePath, ['--remote-debugging-port=0', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', ...args], {
    env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let exitResult, tail = '', browser;
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { exitResult = { code, signal }; resolve(exitResult); }));
  const address = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`App exited before its renderer was ready. ${tail.slice(-4000)}`)));
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', bytes => {
      tail = (tail + bytes.toString()).slice(-64_000);
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+)/i.exec(tail);
      if (match) resolve(match[1]);
    });
  });
  const stopOwned = signal => {
    if (!child.pid || exitResult) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  try {
    const url = await within(address, timeout, 'Timed out waiting for the app renderer endpoint');
    browser = await chromium.connectOverCDP(url, { timeout });
    const context = browser.contexts()[0];
    if (!context) throw new Error('The packaged app has no renderer context');
    return {
      browser,
      context,
      diagnostics: () => ({ exit: exitResult, stderr: tail }),
      firstWindow: async () => context.pages()[0] ?? await context.waitForEvent('page', { timeout }),
      on: (event, listener) => context.on(event === 'window' ? 'page' : event, listener),
      waitForEvent: (event, options) => context.waitForEvent(event === 'window' ? 'page' : event, options),
      async close() {
        try {
          if (!exitResult) {
            const protocol = await browser.newBrowserCDPSession();
            // Electron handles this as an ordinary application quit, including its before-quit handlers.
            await within(protocol.send('Browser.close'), 5000, 'Quit request transport did not settle').catch(error => { if (!exitResult && browser.isConnected()) throw error; });
          }
          const result = exitResult ?? await within(exited, 15_000, 'The packaged app did not quit cleanly');
          if (result.code !== 0 || result.signal) throw new Error(`Unclean app exit: ${JSON.stringify(result)}`);
          return result;
        } finally {
          await within(browser.close(), 3000, 'Renderer transport did not disconnect').catch(() => undefined);
          if (!exitResult) {
            stopOwned('SIGTERM');
            await within(exited, 3000, 'Test process did not terminate').catch(() => stopOwned('SIGKILL'));
          }
        }
      },
    };
  } catch (error) {
    if (browser) await within(browser.close(), 3000, 'Renderer transport did not disconnect').catch(() => undefined);
    stopOwned('SIGTERM');
    await within(exited, 3000, 'Test startup did not terminate').catch(() => stopOwned('SIGKILL'));
    throw error;
  }
}
