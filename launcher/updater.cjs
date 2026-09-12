'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { APP_DIRECTORY, LIMITS, safeRelative, inside, hashFile, checkAbort, extractArchive, walkFiles } = require('./archive.cjs');

const WINDOWS_ASSET = 'DEAD FREQUENCY - Windows.zip';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';
const RECEIPT = '.verified-install.json';
const EXECUTABLE = `${APP_DIRECTORY}/DEAD FREQUENCY.exe`;
const REQUIRED_FILES = [EXECUTABLE, `${APP_DIRECTORY}/resources/app.asar`, `${APP_DIRECTORY}/update-manifest.json`, `${APP_DIRECTORY}/icudtl.dat`, `${APP_DIRECTORY}/resources.pak`, `${APP_DIRECTORY}/ffmpeg.dll`];
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number), prerelease = match[4]?.split('.') || [];
  if (!core.every(Number.isSafeInteger) || prerelease.some(value => /^\d+$/.test(value) && (value.length > 1 && value[0] === '0' || !Number.isSafeInteger(Number(value))))) return null;
  return { core, prerelease, version: core.join('.') + (prerelease.length ? '-' + prerelease.join('.') : ''), stable: !prerelease.length };
}
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid semantic version');
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const l = left.prerelease[i], r = right.prerelease[i];
    if (l === undefined || r === undefined) return l === r ? 0 : l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) > Number(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}
function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || url.port && url.port !== '443') throw new Error('Untrusted update URL');
  return url;
}
function validateRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) throw new Error('Invalid release repository');
  return value;
}
function assetUrl(asset, repository) {
  const url = validateUrl(asset.browser_download_url);
  if (url.hostname !== 'github.com' || !url.pathname.startsWith(`/${repository}/releases/download/`)) throw new Error('Asset belongs to another repository');
  return url.href;
}
function abortable(promise, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || Object.assign(new Error('Update cancelled'), { name: 'AbortError' }));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function resource(url, { transport = fetch, signal, maxBytes, destination = null, expectedSize = null, onBytes = () => {} }) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let idle, totalTimer, response, handle, bytes = 0;
  const hash = crypto.createHash('sha256'), chunks = [];
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new Error('Update connection timed out')), destination ? 25000 : 12000); };
  try {
    totalTimer = setTimeout(() => controller.abort(new Error('Update download timed out')), destination ? 15 * 60_000 : 20_000);
    resetIdle();
    let current = validateUrl(url).href;
    for (let redirects = 0; ; redirects++) {
      response = await abortable(transport(current, { redirect: 'manual', signal: combined, headers: { 'User-Agent': 'DEAD-FREQUENCY-Updater', Accept: current.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream', 'X-GitHub-Api-Version': '2026-03-10' } }), combined);
      if (![301,302,303,307,308].includes(response.status)) break;
      if (redirects >= 5) throw new Error('Too many update redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Empty update redirect');
      response.body?.cancel?.().catch(() => {});
      current = validateUrl(new URL(location, current).href).href;
    }
    if (response.status !== 200) throw new Error(`Update server returned ${response.status}`);
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes || expectedSize !== null && Number(length) !== expectedSize)) throw new Error('Invalid update content length');
    if (!response.body || !response.body[Symbol.asyncIterator]) throw new Error('Empty update response');
    if (destination) handle = await fsp.open(destination, 'wx', 0o600);
    const iterator = response.body[Symbol.asyncIterator]();
    for (;;) {
      const { value, done } = await abortable(iterator.next(), combined); if (done) break;
      const chunk = Buffer.from(value); bytes += chunk.length;
      if (bytes > maxBytes || expectedSize !== null && bytes > expectedSize) throw new Error('Update download exceeds size limit');
      hash.update(chunk);
      if (handle) {
        let offset = 0;
        while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw new Error('Cannot write update'); offset += result.bytesWritten; }
      } else chunks.push(chunk);
      resetIdle(); onBytes(bytes);
    }
    if (expectedSize !== null && bytes !== expectedSize) throw new Error('Incomplete update download');
    if (handle) await handle.sync();
    return { bytes, sha256: hash.digest('hex'), data: destination ? null : Buffer.concat(chunks) };
  } finally {
    clearTimeout(idle); clearTimeout(totalTimer);
    controller.abort();
    await handle?.close();
  }
}
function parseChecksum(text, name) {
  const matches = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line)).filter(match => match && match[2] === name);
  if (matches.length !== 1) throw new Error('Missing or ambiguous archive checksum');
  return matches[0][1].toLowerCase();
}
async function verifyInstalled(directory, { repository, version, signal }) {
  try {
    checkAbort(signal);
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const receiptPath = path.join(directory, RECEIPT), receiptStat = await fsp.lstat(receiptPath);
    if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 2 * 1024 ** 2) return null;
    const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
    if (receipt.schema !== 1 || receipt.repository !== repository || receipt.version !== version || !/^[a-f0-9]{64}$/.test(receipt.archiveSha256) || receipt.exe !== EXECUTABLE || !Array.isArray(receipt.files) || receipt.files.length > LIMITS.entries) return null;
    const names = new Set(), diskFiles = await walkFiles(directory, signal, LIMITS.entries + 1);
    if (diskFiles.length !== receipt.files.length + 1) return null;
    let total = 0;
    for (const file of receipt.files) {
      checkAbort(signal);
      if (safeRelative(file.path) !== file.path || names.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.file) return null;
      names.add(file.path.toLowerCase()); total += file.size;
      if (total > LIMITS.unpacked) return null;
      const filename = inside(directory, file.path), fileStat = await fsp.lstat(filename);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== file.size || await hashFile(filename, signal) !== file.sha256) return null;
    }
    if (!REQUIRED_FILES.every(name => names.has(name.toLowerCase()))) return null;
    await verifyManifest(directory, version);
    return { exe: inside(directory, EXECUTABLE), version, source: 'installed', updated: false };
  } catch (error) { if (signal?.aborted || error.name === 'AbortError') throw error; return null; }
}
async function verifyManifest(directory, version) {
  const filename = inside(directory, `${APP_DIRECTORY}/update-manifest.json`);
  const stat = await fsp.stat(filename);
  if (stat.size > 4096) throw new Error('Invalid application manifest');
  const manifest = JSON.parse(await fsp.readFile(filename, 'utf8'));
  if (manifest.schema !== 1 || manifest.application !== 'DEAD FREQUENCY' || manifest.version !== version || manifest.executable !== 'DEAD FREQUENCY.exe') throw new Error('Release version does not match application manifest');
}
async function selectInstalled(versionsRoot, baseline, repository, signal) {
  let directories;
  try { directories = await fsp.readdir(versionsRoot, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return baseline; throw error; }
  const candidates = directories.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && parseVersion(entry.name)?.stable && parseVersion(entry.name).version === entry.name && compareVersions(entry.name, baseline.version) > 0).sort((a, b) => compareVersions(b.name, a.name));
  for (const entry of candidates) {
    const found = await verifyInstalled(path.join(versionsRoot, entry.name), { repository, version: entry.name, signal });
    if (found) return found;
  }
  return baseline;
}
async function writePointer(root, version) {
  const temporary = path.join(root, `.current-${crypto.randomUUID()}.json`);
  try { await fsp.writeFile(temporary, JSON.stringify({ schema: 1, version }), { flag: 'wx' }); await fsp.rename(temporary, path.join(root, 'current.json')); }
  finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
}
async function removeOwnedStage(root, stage) {
  if (path.dirname(stage) !== root || !path.basename(stage).startsWith('.stage-')) throw new Error('Invalid update cleanup path');
  await fsp.rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}
async function publishVersion(payload, target, verification) {
  for (let attempt = 0; ; attempt++) {
    checkAbort(verification.signal);
    try { await fsp.rename(payload, target); return; }
    catch (error) {
      if (!['EEXIST','ENOTEMPTY','EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
      const targetExists = await fsp.lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (targetExists) {
        if (await verifyInstalled(target, verification)) return;
        throw new Error('Existing version could not be safely replaced');
      }
      // Windows scanners can briefly lock freshly written executable files.
      // Retry only a missing target; never replace an existing installation.
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function runUpdater({ currentVersion, bundledExe, installRoot, repository, onProgress = () => {}, signal, transport } = {}) {
  const parsedCurrent = parseVersion(currentVersion);
  if (!parsedCurrent || !parsedCurrent.stable) throw new Error('Launcher requires a stable bundled version');
  validateRepository(repository);
  if (!path.isAbsolute(bundledExe || '') || !path.isAbsolute(installRoot || '')) throw new Error('Updater paths must be absolute');
  checkAbort(signal);
  const bundledStat = await fsp.stat(bundledExe);
  if (!bundledStat.isFile()) throw new Error('Bundled game is unavailable');
  let selected = { exe: bundledExe, version: parsedCurrent.version, source: 'bundled', updated: false }, root = path.resolve(installRoot), stage;
  const progress = event => { try { onProgress(event); } catch {} };
  progress({ phase: 'checking', message: 'Updates werden geprüft', version: selected.version });
  try {
    await fsp.mkdir(root, { recursive: true }); root = await fsp.realpath(root);
    const versionsRoot = path.join(root, 'versions'); await fsp.mkdir(versionsRoot, { recursive: true });
    const versionStat = await fsp.lstat(versionsRoot);
    if (!versionStat.isDirectory() || versionStat.isSymbolicLink()) throw new Error('Invalid versions directory');
    selected = await selectInstalled(versionsRoot, selected, repository, signal);
    progress({ phase: 'checking', message: 'Neueste Veröffentlichung wird geprüft', version: selected.version });
    const metadata = await resource(`https://api.github.com/repos/${repository}/releases/latest`, { transport, signal, maxBytes: 2 * 1024 ** 2 });
    const release = JSON.parse(metadata.data.toString('utf8'));
    const version = parseVersion(release.tag_name);
    if (release.draft || release.prerelease || !version?.stable) throw new Error('Release is not a stable version');
    if (compareVersions(version.version, selected.version) <= 0) {
      progress({ phase: 'starting', message: 'Spiel startet', version: selected.version }); return selected;
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const matches = assets.filter(asset => asset.name === WINDOWS_ASSET && asset.state === 'uploaded');
    if (matches.length !== 1) throw new Error('Windows release asset is missing or ambiguous');
    const asset = matches[0], downloadUrl = assetUrl(asset, repository);
    if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > LIMITS.archive) throw new Error('Windows archive size is invalid');
    let expectedHash;
    if (typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) expectedHash = asset.digest.slice(7).toLowerCase();
    else {
      const checksumAssets = assets.filter(asset => asset.name === CHECKSUM_ASSET && asset.state === 'uploaded');
      if (checksumAssets.length !== 1) throw new Error('Release has no SHA-256 verification');
      const checksums = await resource(assetUrl(checksumAssets[0], repository), { transport, signal, maxBytes: 256 * 1024 });
      expectedHash = parseChecksum(checksums.data.toString('utf8'), WINDOWS_ASSET);
    }
    checkAbort(signal);
    stage = await fsp.mkdtemp(path.join(root, '.stage-'));
    const archive = path.join(stage, 'release.zip'), payload = path.join(stage, 'payload');
    progress({ phase: 'downloading', message: 'Update wird automatisch heruntergeladen', version: version.version, percent: 0, bytes: 0, total: asset.size });
    const downloaded = await resource(downloadUrl, { transport, signal, maxBytes: LIMITS.archive, destination: archive, expectedSize: asset.size,
      onBytes: bytes => progress({ phase: 'downloading', message: 'Update wird automatisch heruntergeladen', version: version.version, percent: bytes / asset.size * 100, bytes, total: asset.size }) });
    progress({ phase: 'verifying', message: 'Download wird auf Integrität geprüft', version: version.version });
    if (downloaded.sha256 !== expectedHash) throw new Error('SHA-256 verification failed');
    checkAbort(signal);
    progress({ phase: 'extracting', message: 'Geprüfte Version wird vorbereitet', version: version.version, percent: 0 });
    const files = await extractArchive(archive, payload, { signal, onProgress: ({ completed, entries }) => progress({ phase: 'extracting', message: 'Geprüfte Version wird vorbereitet', version: version.version, percent: completed / entries * 100 }) });
    const names = new Set(files.map(file => file.path));
    if (!REQUIRED_FILES.every(name => names.has(name))) throw new Error('Incomplete Windows release');
    await verifyManifest(payload, version.version);
    await fsp.writeFile(path.join(payload, RECEIPT), JSON.stringify({ schema: 1, repository, version: version.version, archiveSha256: expectedHash, installedAt: new Date().toISOString(), exe: EXECUTABLE, files }, null, 2), { flag: 'wx' });
    checkAbort(signal);
    const target = path.join(versionsRoot, version.version);
    await publishVersion(payload, target, { repository, version: version.version, signal });
    selected = { exe: inside(target, EXECUTABLE), version: version.version, source: 'downloaded', updated: true };
    // The pointer is a convenience only; every launch discovers and verifies
    // complete version directories, so an interrupted pointer write is harmless.
    await writePointer(root, selected.version).catch(() => {});
    progress({ phase: 'starting', message: 'Neue Version startet', version: selected.version });
    return selected;
  } catch (error) {
    checkAbort(signal);
    if (error.name === 'AbortError') throw error;
    progress({ phase: 'fallback', message: 'Update nicht verfügbar. Die geprüfte Version startet.', version: selected.version });
    return { ...selected, fallback: true, error: { message: error.message } };
  } finally { if (stage) await removeOwnedStage(root, stage).catch(() => {}); }
}

module.exports = { runUpdater, parseVersion, compareVersions, validateUrl, parseChecksum, verifyInstalled, WINDOWS_ASSET, CHECKSUM_ASSET, RECEIPT, EXECUTABLE, REQUIRED_FILES };
