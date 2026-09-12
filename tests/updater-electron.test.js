import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const require = createRequire(import.meta.url);
const { APP_DIRECTORY, crc32 } = require('../launcher/archive.cjs');
const { REQUIRED_FILES } = require('../launcher/updater.cjs');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function physicalAsarFixture() {
  const local = [], central = []; let offset = 0;
  for (const file of REQUIRED_FILES) {
    const name = Buffer.from(file);
    const data = Buffer.from(file.endsWith('update-manifest.json')
      ? JSON.stringify({ schema: 1, application: 'DEAD FREQUENCY', version: '1.3.0', executable: 'DEAD FREQUENCY.exe' })
      : file.endsWith('app.asar') ? 'Physical ASAR bytes must not be interpreted as a mounted archive' : 'fixture bytes');
    const crc = crc32(data), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(record, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(REQUIRED_FILES.length, 8); end.writeUInt16LE(REQUIRED_FILES.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]).toString('base64');
}

test('Native Electron installs and revalidates app.asar as a physical file', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'dead-frequency-native-updater-test-'));
  let native;
  try {
    const entry = path.join(root, 'main.cjs');
    await fs.writeFile(entry, "const {app}=require('electron'); app.setPath('userData',process.env.DF_UPDATER_NATIVE_PROFILE); app.whenReady();");
    const env = { ...process.env, DF_UPDATER_NATIVE_PROFILE: path.join(root, 'profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    native = await _electron.launch({ executablePath: require('electron'), args: [entry], env, timeout: 20000 });
    const result = await native.evaluate(async ({ app }, { root, project, archive }) => {
      await app.whenReady();
      const path = process.getBuiltinModule('node:path');
      const nativeRequire = process.getBuiltinModule('node:module').createRequire(path.join(project, 'package.json'));
      const { runUpdater, WINDOWS_ASSET } = nativeRequire(path.join(project, 'launcher/updater.cjs'));
      const { createHash } = process.getBuiltinModule('node:crypto');
      const physicalFs = nativeRequire('original-fs').promises;
      const bytes = Buffer.from(archive, 'base64');
      const repo = 'easycrashx-nex/dead-frequency';
      const assetUrl = `https://github.com/${repo}/releases/download/v1.3.0/${encodeURIComponent(WINDOWS_ASSET)}`;
      const release = { tag_name: 'v1.3.0', draft: false, prerelease: false, assets: [{ name: WINDOWS_ASSET, state: 'uploaded', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, browser_download_url: assetUrl }] };
      const transport = async url => {
        if (url === `https://api.github.com/repos/${repo}/releases/latest`) return new Response(JSON.stringify(release));
        if (url === assetUrl) return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
        throw new Error(`Unexpected fixture request: ${url}`);
      };
      const options = { currentVersion: '1.2.2', bundledExe: process.execPath, installRoot: path.join(root, 'updates'), repository: repo };
      const installed = await runUpdater({ ...options, transport });
      const offline = await runUpdater({ ...options, transport: async () => { throw new Error('Fixture offline'); } });
      const asarPath = path.join(root, 'updates/versions/1.3.0/DEAD FREQUENCY-win32-x64/resources/app.asar');
      const physicalContents = await physicalFs.readFile(asarPath, 'utf8').catch(() => null);
      return { installed, offline, physicalContents, electron: process.versions.electron };
    }, { root, project, archive: physicalAsarFixture() });
    assert.equal(result.installed.source, 'downloaded', JSON.stringify(result));
    assert.equal(result.offline.source, 'installed', JSON.stringify(result));
    assert.equal(result.offline.exe, result.installed.exe);
    assert.equal(result.offline.fallback, true);
    assert.equal(result.physicalContents, 'Physical ASAR bytes must not be interpreted as a mounted archive');
    assert.ok(result.installed.exe.includes(APP_DIRECTORY));
  } finally {
    if (native) await native.close();
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('dead-frequency-native-updater-test-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
