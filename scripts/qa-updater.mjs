import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), output = path.resolve('work/qa-updater');
await fs.mkdir(output, { recursive: true });
const args = process.argv.slice(2), argument = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };

if (args.includes('--live')) {
  // Explicit QA simulates an older launcher, but uses the unmodified production
  // GitHub transport, host policy, release metadata and verification pipeline.
  const { runUpdater } = require('../launcher/updater.cjs');
  const bundledExe = path.resolve(argument('--bundled') || '');
  assert.ok(argument('--bundled'), 'Live QA needs --bundled <existing packaged EXE>');
  const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dead-frequency-live-update-'));
  const currentVersion = argument('--current') || '1.2.2', events = [];
  let lastPhase;
  const options = { currentVersion, bundledExe, installRoot, repository: 'easycrashx-nex/dead-frequency' };
  const result = await runUpdater({ ...options, onProgress(event) {
    if (lastPhase !== event.phase) { console.log(event.phase, event.version || '', event.message); lastPhase = event.phase; }
    events.push({ ...event, at: new Date().toISOString() });
  } });
  const report = { checkedAt: new Date().toISOString(), mode: 'live-public-GitHub', currentVersion, installRoot, result, events };
  await fs.writeFile(path.join(output, 'live.json'), JSON.stringify(report, null, 2));
  assert.equal(result.source, 'downloaded', JSON.stringify(result));
  const offline = await runUpdater({ ...options, transport: async () => { throw new Error('Explicit QA offline simulation'); } });
  assert.equal(offline.source, 'installed'); assert.equal(offline.exe, result.exe); assert.equal(offline.fallback, true);
  report.offline = offline;
  await fs.writeFile(path.join(output, 'live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ live: 'PASS', offline: 'PASS', version: result.version, exe: result.exe, installRoot, report: path.join(output, 'live.json') }, null, 2));
} else {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const checks = [], errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => { window.launcher = { onProgress(callback) { window.__qaProgress = callback; return () => { window.__qaUnsubscribed = true; }; } }; });
    await page.goto(pathToFileURL(path.resolve('launcher/index.html')).href);
    await page.waitForFunction(() => typeof window.__qaProgress === 'function');
    for (const viewport of [{ width: 1040, height: 650 }, { width: 960, height: 600 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.__qaProgress({ phase: 'downloading', message: 'Update wird automatisch heruntergeladen', version: '1.3.0', percent: 64, bytes: 167_772_160, total: 262_144_000 }));
      await page.locator('#progress[aria-valuenow="64"]').waitFor();
      await page.waitForFunction(() => Math.abs(document.querySelector('#progress-fill').getBoundingClientRect().width / document.querySelector('#progress').getBoundingClientRect().width - .64) < .005);
      const layout = await page.evaluate(() => {
        const elements = ['.topline','h1','#status','.progress-track','.steps','.detail','footer'];
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: elements.map(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }) };
      });
      assert.ok(layout.scrollWidth <= viewport.width, JSON.stringify(layout));
      for (const rect of layout.elements) {
        assert.ok(rect.left >= 0 && rect.right <= viewport.width + 1, JSON.stringify(rect));
        assert.ok(rect.top >= 0 && rect.bottom <= viewport.height + 1, JSON.stringify(rect));
      }
      await page.screenshot({ path: path.join(output, `launcher-${viewport.width}x${viewport.height}.png`) });
      checks.push(`Layout ${viewport.width}x${viewport.height}: readable within viewport`);
    }
    const phases = ['checking','downloading','verifying','extracting','starting','fallback'];
    for (const phase of phases) {
      await page.evaluate(phase => window.__qaProgress({ phase, message: phase, version: '1.3.0', ...(phase === 'extracting' ? { percent: 48 } : {}) }), phase);
      assert.equal(await page.locator('body').getAttribute('data-phase'), phase);
      assert.equal(await page.locator('#status').textContent(), phase);
      checks.push(`Progress state ${phase}: pass`);
    }
    await page.evaluate(() => window.__qaProgress({ phase: 'checking', message: '<img src=x onerror=window.__injected=true>' }));
    assert.equal(await page.locator('#status img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
    checks.push('IPC text renders as text, no HTML execution');
    assert.deepEqual(errors, []); checks.push('No JavaScript or Content-Security-Policy errors');
    const report = { checkedAt: new Date().toISOString(), checks, errors };
    await fs.writeFile(path.join(output, 'ui.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
