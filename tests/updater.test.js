import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { runUpdater, parseVersion, compareVersions, validateUrl, parseChecksum, WINDOWS_ASSET, CHECKSUM_ASSET, EXECUTABLE, REQUIRED_FILES, RECEIPT } = require('../launcher/updater.cjs');
const { APP_DIRECTORY, LIMITS, crc32, extractArchive } = require('../launcher/archive.cjs');
const REPOSITORY = 'easycrashx-nex/dead-frequency';
// Keep staging outside Vite's watched project tree, like the real userData cache.
const TEST_ROOT = path.join(os.tmpdir(), 'dead-frequency-updater-tests');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const filename = name => `${APP_DIRECTORY}/${name}`;
const releaseUrl = (version, name) => `https://github.com/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(name)}`;

// Small, independently assembled ZIP fixtures let us exercise malformed paths,
// type flags and CRC values that ordinary ZIP writers correctly refuse to emit.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path), data = Buffer.from(entry.data ?? 'fixture');
    const method = entry.deflate ? 8 : 0, compressed = method ? deflateRawSync(data) : data;
    const size = entry.declaredSize ?? data.length, crc = entry.crc ?? crc32(data);
    const flags = 0x800 | (entry.encrypted ? 1 : 0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc >>> 0, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc >>> 0, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((entry.mode ?? 0x81a4) * 0x10000) >>> 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}
function files(version = '1.3.0') {
  return REQUIRED_FILES.map(name => ({ path: name, data: name.endsWith('update-manifest.json')
    ? JSON.stringify({ schema: 1, application: 'DEAD FREQUENCY', version, executable: 'DEAD FREQUENCY.exe' })
    : name.endsWith('.exe') ? 'MZ fixture executable; never run' : `fixture contents for ${name}`, deflate: true }));
}
function fixtureTransport(archive, { version = '1.3.0', digest = true, metadata = {}, archiveResponse, checksumText, fail = false } = {}) {
  const requests = [], url = releaseUrl(version, WINDOWS_ASSET), checksumUrl = releaseUrl(version, CHECKSUM_ASSET);
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, assets: [
    { name: WINDOWS_ASSET, state: 'uploaded', size: archive.length, browser_download_url: url, ...(digest ? { digest: `sha256:${sha256(archive)}` } : {}) },
    { name: CHECKSUM_ASSET, state: 'uploaded', size: 100, browser_download_url: checksumUrl }
  ], ...metadata };
  const responses = new Map([
    [`https://api.github.com/repos/${REPOSITORY}/releases/latest`, () => response(JSON.stringify(release))],
    [url, archiveResponse || (() => response(archive))],
    [checksumUrl, () => response(checksumText ?? `${sha256(archive)}  ${WINDOWS_ASSET}\n`)]
  ]);
  const transport = async (url, options) => {
    requests.push({ url, options });
    if (fail) throw new Error('Fixture offline');
    assert.equal(options.redirect, 'manual');
    const factory = responses.get(url);
    assert.ok(factory, `Unexpected requested URL: ${url}`);
    return factory();
  };
  return { transport, requests, release, responses, url };
}
function response(data) { const bytes = Buffer.from(data); return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }); }
async function setup(t) {
  await fs.mkdir(TEST_ROOT, { recursive: true });
  const root = await fs.mkdtemp(path.join(TEST_ROOT, 'case-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), TEST_ROOT, 'cleanup must remain inside isolated test root');
    assert.match(path.basename(root), /^case-/);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 });
  });
  const bundledExe = path.join(root, 'bundled.exe'); await fs.writeFile(bundledExe, 'bundled original');
  const options = { currentVersion: '1.2.2', bundledExe, installRoot: path.join(root, 'updates'), repository: REPOSITORY };
  return { root, options };
}
async function noStages(options) { assert.deepEqual((await fs.readdir(options.installRoot)).filter(name => name.startsWith('.stage-')), []); }
async function install(t, { version = '1.3.0', options, archive = zip(files(version)), transportOptions = {}, onProgress } = {}) {
  options ||= (await setup(t)).options;
  const fixture = fixtureTransport(archive, { version, ...transportOptions });
  const result = await runUpdater({ ...options, transport: fixture.transport, onProgress });
  return { result, options, fixture, archive };
}

test('SemVer compares numeric versions, prereleases and build metadata correctly', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.3.0+build7', '1.3.0+build8'), 0);
  const versions = ['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0'];
  for (let i = 1; i < versions.length; i++) assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
  for (const bad of ['1.02.3','1.2','../1.3.0','1.2.3-01','1.2.3\n','9007199254740992.0.0']) assert.equal(parseVersion(bad), null, bad);
});
test('CRC32 matches the known vector across stream boundaries', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('56789'), crc32(Buffer.from('1234'))), 0xcbf43926);
});
test('URLs reject HTTP, credentials, deceptive hosts and unexpected ports', () => {
  for (const url of ['http://github.com/x','https://github.com.evil.test/x','https://github.com@evil.test/x','https://user:pw@github.com/x','https://github.com:444/x','file:///tmp/x','https://raw.githubusercontent.com/x']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl('https://release-assets.githubusercontent.com/github-production-release-asset/x').protocol, 'https:');
});
test('Checksums require one exact matching Windows asset name', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseChecksum(`${digest} *${WINDOWS_ASSET}\r\n`, WINDOWS_ASSET), digest);
  assert.throws(() => parseChecksum(`${digest}  wrong.zip`, WINDOWS_ASSET));
  assert.throws(() => parseChecksum(`${digest}  ${WINDOWS_ASSET}\n${digest}  ${WINDOWS_ASSET}`, WINDOWS_ASSET));
});
test('A verified release installs atomically and records every file hash', async t => {
  const progress = [], { result, options, fixture } = await install(t, { onProgress: value => progress.push(value) });
  assert.equal(result.source, 'downloaded', JSON.stringify(result)); assert.equal(result.version, '1.3.0'); assert.equal(result.updated, true);
  const target = path.join(options.installRoot, 'versions', result.version);
  assert.equal(result.exe, path.join(target, ...EXECUTABLE.split('/')));
  const receipt = JSON.parse(await fs.readFile(path.join(target, RECEIPT), 'utf8'));
  assert.equal(receipt.files.length, REQUIRED_FILES.length);
  for (const file of receipt.files) assert.equal(sha256(await fs.readFile(path.join(target, ...file.path.split('/')))), file.sha256);
  assert.deepEqual([...new Set(progress.map(value => value.phase))], ['checking','downloading','verifying','extracting','starting']);
  assert.equal(await fs.readFile(options.bundledExe, 'utf8'), 'bundled original');
  assert.equal(fixture.requests.length, 2); await noStages(options);
});
test('A release without API digest uses SHA256SUMS.txt', async t => {
  const { result, fixture } = await install(t, { transportOptions: { digest: false } });
  assert.equal(result.source, 'downloaded'); assert.equal(fixture.requests.length, 3);
});
test('A transient Windows file lock is retried without replacing an existing version', async t => {
  const original = fs.rename; let interrupted = false;
  const writes = [], createWriteStream = fsSync.createWriteStream;
  fsSync.createWriteStream = (...args) => { const stream = createWriteStream(...args); writes.push(stream); return stream; };
  fs.rename = async (source, destination) => {
    if (!interrupted && path.basename(source) === 'payload') { interrupted = true; throw Object.assign(new Error('fixture Windows file lock'), { code: 'EPERM' }); }
    for (const stream of writes) { assert.equal(stream.closed, true); assert.equal(stream.fd, null); }
    return original(source, destination);
  };
  try {
    const { result, options } = await install(t);
    assert.equal(interrupted, true); assert.equal(result.source, 'downloaded', JSON.stringify(result)); await noStages(options);
  } finally { fs.rename = original; fsSync.createWriteStream = createWriteStream; }
});
test('A corrupt pre-existing version is not overwritten', async t => {
  const { options } = await setup(t), target = path.join(options.installRoot, 'versions', '1.3.0');
  await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'untouched.exe'), 'original');
  const { result } = await install(t, { options });
  assert.equal(result.source, 'bundled'); assert.match(result.error.message, /safely replaced/);
  assert.equal(await fs.readFile(path.join(target, 'untouched.exe'), 'utf8'), 'original'); await noStages(options);
});
test('Real HTTP fixture downloads through the explicitly injected transport', async t => {
  const archive = zip(files()), fixture = fixtureTransport(archive), { options } = await setup(t);
  const server = http.createServer((request, reply) => {
    const isMetadata = request.url.startsWith('/repos/');
    const bytes = isMetadata ? Buffer.from(JSON.stringify(fixture.release)) : archive;
    reply.writeHead(200, { 'content-length': bytes.length, 'content-type': isMetadata ? 'application/json' : 'application/zip' });
    reply.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const transport = (url, settings) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, settings);
  const result = await runUpdater({ ...options, transport });
  assert.equal(result.source, 'downloaded'); await noStages(options);
});
test('Offline first launch falls back to the bundled executable', async t => {
  const { options } = await setup(t), fixture = fixtureTransport(zip(files()), { fail: true });
  const result = await runUpdater({ ...options, transport: fixture.transport });
  assert.equal(result.exe, options.bundledExe); assert.equal(result.fallback, true); assert.equal(result.source, 'bundled');
});
test('Older or equal remote releases never downgrade the installed selection', async t => {
  const { options } = await install(t);
  for (const version of ['1.2.0','1.3.0']) {
    const fixture = fixtureTransport(zip(files(version)), { version });
    const result = await runUpdater({ ...options, transport: fixture.transport });
    assert.equal(result.version, '1.3.0'); assert.equal(result.source, 'installed'); assert.equal(fixture.requests.length, 1);
  }
});
test('Highest verified cached version survives offline and an untrusted pointer', async t => {
  const { options } = await install(t);
  await install(t, { options, version: '1.4.0' });
  await fs.writeFile(path.join(options.installRoot, 'current.json'), JSON.stringify({ version: '../../arbitrary.exe', exe: 'evil.exe' }));
  const fixture = fixtureTransport(zip(files()), { fail: true });
  const result = await runUpdater({ ...options, transport: fixture.transport });
  assert.equal(result.version, '1.4.0'); assert.equal(result.source, 'installed'); assert.equal(result.fallback, true);
});
test('Same-size tampering of a cached DLL rejects it and selects the previous verified version', async t => {
  const { options } = await install(t);
  await install(t, { options, version: '1.4.0' });
  const dll = path.join(options.installRoot, 'versions', '1.4.0', APP_DIRECTORY, 'ffmpeg.dll');
  const data = await fs.readFile(dll); data[0] ^= 1; await fs.writeFile(dll, data);
  const result = await runUpdater({ ...options, transport: fixtureTransport(zip(files()), { fail: true }).transport });
  assert.equal(result.version, '1.3.0'); assert.equal(result.source, 'installed');
});
test('Unrecorded executable files invalidate a cached installation', async t => {
  const { options } = await install(t);
  await fs.writeFile(path.join(options.installRoot, 'versions', '1.3.0', APP_DIRECTORY, 'unexpected.exe'), 'MZ');
  const result = await runUpdater({ ...options, transport: fixtureTransport(zip(files()), { fail: true }).transport });
  assert.equal(result.source, 'bundled');
});
test('Digest mismatch leaves no install and preserves bundled bytes', async t => {
  const archive = zip(files()), fixture = fixtureTransport(archive); fixture.release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  const { options } = await setup(t), result = await runUpdater({ ...options, transport: fixture.transport });
  assert.equal(result.source, 'bundled'); assert.match(result.error.message, /SHA-256/);
  assert.deepEqual(await fs.readdir(path.join(options.installRoot, 'versions')), []); await noStages(options);
});
test('Truncated downloads are rejected before extraction', async t => {
  const archive = zip(files()), { result, options } = await install(t, { archive, transportOptions: { archiveResponse: () => new Response(archive.subarray(0, archive.length - 10), { status: 200 }) } });
  assert.equal(result.source, 'bundled'); assert.match(result.error.message, /Incomplete/); await noStages(options);
});
test('Wrong declared HTTP length is rejected', async t => {
  const archive = zip(files()), { result, options } = await install(t, { archive, transportOptions: { archiveResponse: () => new Response(archive, { headers: { 'content-length': String(archive.length + 1) } }) } });
  assert.match(result.error.message, /content length/); await noStages(options);
});
test('Corrupt ZIP with a correct outer SHA256 is rejected', async t => {
  const { result, options } = await install(t, { archive: Buffer.from('this is not a zip') });
  assert.equal(result.source, 'bundled'); assert.equal(result.fallback, true); await noStages(options);
});
test('Incorrect per-entry CRC is rejected even when outer SHA256 is valid', async t => {
  const entries = files(); entries[0].crc = 123;
  const { result, options } = await install(t, { archive: zip(entries) });
  assert.equal(result.source, 'bundled'); assert.match(result.error.message, /CRC/); await noStages(options);
});
for (const [name, entry] of [
  ['parent traversal', { path: `${APP_DIRECTORY}/../escape.exe` }],
  ['absolute path', { path: '/absolute/escape.exe' }],
  ['backslash traversal', { path: `${APP_DIRECTORY}\\..\\escape.exe` }],
  ['alternate data stream', { path: filename('safe.exe:payload') }],
  ['Windows reserved device', { path: filename('CON.txt') }],
  ['trailing-dot alias', { path: filename('alias.exe.') }],
  ['unrelated wrapper', { path: 'OTHER/evil.exe' }],
  ['symbolic link', { path: filename('linked.exe'), mode: 0xa1ff, data: '../../outside' }],
  ['encrypted entry', { path: filename('secret.dat'), encrypted: true }]
]) test(`Archive rejects ${name}`, async t => {
  const { options, root } = await setup(t);
  const installed = await install(t, { options, archive: zip([...files(), entry]) });
  assert.equal(installed.result.source, 'bundled'); assert.equal(installed.result.fallback, true);
  assert.equal((await fs.readdir(root)).includes('escape.exe'), false); await noStages(options);
});
test('Case-insensitive duplicate files and file-directory collisions are rejected', async t => {
  const { options } = await setup(t);
  for (const entries of [
    [...files(), { path: filename('FFMPEG.DLL') }],
    [...files(), { path: filename('folder') }, { path: filename('folder/child') }],
    [...files(), { path: filename('folder/child') }, { path: filename('folder') }]
  ]) {
    const { result } = await install(t, { options, archive: zip(entries) });
    assert.equal(result.source, 'bundled'); assert.match(result.error.message, /Duplicate|parent is a file/); await noStages(options);
  }
});
test('Expansion ratio and oversized declarations are rejected', async t => {
  const { options } = await setup(t);
  for (const entry of [
    { path: filename('bomb.bin'), data: Buffer.alloc(200_000), deflate: true },
    { path: filename('oversized.bin'), data: 'small', deflate: true, declaredSize: LIMITS.file + 1 }
  ]) {
    const { result } = await install(t, { options, archive: zip([...files(), entry]) });
    assert.equal(result.source, 'bundled'); assert.match(result.error.message, /limit/); await noStages(options);
  }
});
test('Entry count and aggregate extraction limits are enforced', async t => {
  const { root } = await setup(t), archive = path.join(root, 'fixture.zip'); await fs.writeFile(archive, zip(files()));
  await assert.rejects(extractArchive(archive, path.join(root, 'entry-limit'), { limits: { ...LIMITS, entries: 2 } }), /entry limit/);
  await assert.rejects(extractArchive(archive, path.join(root, 'byte-limit'), { limits: { ...LIMITS, unpacked: 10 } }), /expansion limit/);
});
test('Missing mandatory files and mismatched application manifest cannot install', async t => {
  const { options } = await setup(t);
  for (const entries of [files().filter(file => !file.path.endsWith('app.asar')), files('9.9.9')]) {
    const { result } = await install(t, { options, archive: zip(entries) });
    assert.equal(result.source, 'bundled'); assert.match(result.error.message, /Incomplete|manifest/); await noStages(options);
  }
});
test('Draft, prerelease and malformed release metadata are refused', async t => {
  const { options } = await setup(t);
  for (const metadata of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.3.0-beta.1' }, { tag_name: '../../evil' }]) {
    const { result, fixture } = await install(t, { options, transportOptions: { metadata } });
    assert.equal(result.source, 'bundled'); assert.equal(result.fallback, true); assert.equal(fixture.requests.length, 1);
  }
});
test('Asset from another repository and oversized archive are rejected before transfer', async t => {
  const { options } = await setup(t), archive = zip(files());
  for (const mutate of [asset => asset.browser_download_url = 'https://github.com/other/repo/releases/download/v1.3.0/update.zip', asset => asset.size = LIMITS.archive + 1]) {
    const fixture = fixtureTransport(archive); mutate(fixture.release.assets[0]);
    const result = await runUpdater({ ...options, transport: fixture.transport });
    assert.equal(result.source, 'bundled'); assert.equal(result.fallback, true); assert.equal(fixture.requests.length, 1);
  }
});
test('A redirect cannot escape the exact HTTPS host allowlist', async t => {
  const archive = zip(files()), { result, fixture } = await install(t, { archive, transportOptions: { archiveResponse: () => new Response(null, { status: 302, headers: { location: 'https://github.com.evil.test/payload' } }) } });
  assert.equal(result.source, 'bundled'); assert.match(result.error.message, /Untrusted/); assert.equal(fixture.requests.length, 2);
});
test('An allowed GitHub release CDN redirect can complete', async t => {
  const archive = zip(files()), fixture = fixtureTransport(archive), { options } = await setup(t);
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?token=public';
  fixture.responses.set(fixture.url, () => new Response(null, { status: 302, headers: { location: cdn } }));
  fixture.responses.set(cdn, () => response(archive));
  const result = await runUpdater({ ...options, transport: fixture.transport });
  assert.equal(result.source, 'downloaded'); assert.equal(fixture.requests.length, 3);
});
test('Aborting an active download removes staging and preserves the prior verified install', async t => {
  const { options } = await install(t), controller = new AbortController(), fixture = fixtureTransport(zip(files('1.4.0')), { version: '1.4.0' });
  await assert.rejects(runUpdater({ ...options, transport: fixture.transport, signal: controller.signal, onProgress(event) { if (event.phase === 'downloading' && event.bytes > 0) controller.abort(); } }), { name: 'AbortError' });
  await noStages(options);
  assert.deepEqual(await fs.readdir(path.join(options.installRoot, 'versions')), ['1.3.0']);
  const result = await runUpdater({ ...options, transport: fixtureTransport(zip(files()), { fail: true }).transport });
  assert.equal(result.version, '1.3.0');
});
test('Abort interrupts a transport that never resolves', async t => {
  const { options } = await setup(t), controller = new AbortController();
  const started = Date.now(), transport = () => { setTimeout(() => controller.abort(), 10); return new Promise(() => {}); };
  await assert.rejects(runUpdater({ ...options, transport, signal: controller.signal }), { name: 'AbortError' });
  assert.ok(Date.now() - started < 1500); await noStages(options);
});
test('Closing before updater work begins causes no filesystem or network work', async t => {
  const { options } = await setup(t), controller = new AbortController(); controller.abort();
  await assert.rejects(runUpdater({ ...options, signal: controller.signal, transport: () => assert.fail('must not fetch') }), { name: 'AbortError' });
  await assert.rejects(fs.stat(options.installRoot), { code: 'ENOENT' });
});
