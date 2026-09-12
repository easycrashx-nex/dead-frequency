'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const APP_DIRECTORY = 'DEAD FREQUENCY-win32-x64';
const LIMITS = Object.freeze({ archive: 512 * 1024 ** 2, unpacked: 2 * 1024 ** 3, file: 512 * 1024 ** 2, entries: 4096, ratio: 300 });
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(bytes, previous = 0) {
  if (zlib.crc32) return zlib.crc32(bytes, previous);
  let n = previous ^ 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ n >>> 8;
  return (n ^ 0xffffffff) >>> 0;
}
function checkAbort(signal) { if (signal?.aborted) throw Object.assign(new Error('Update cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }); }
function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')) throw new Error('Unsafe archive path');
  const parts = name.replace(/\/$/, '').split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[<>"|?*]/.test(part)) throw new Error('Unsafe Windows archive path');
  }
  if (parts[0] !== APP_DIRECTORY) throw new Error('Unexpected application directory');
  return parts.join('/');
}
function inside(root, relative) {
  const result = path.resolve(root, ...relative.split('/'));
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes update directory');
  return result;
}
async function hashFile(filename, signal) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) { checkAbort(signal); hash.update(chunk); }
  return hash.digest('hex');
}
async function assertRegularParents(root, filename) {
  let parent = path.dirname(filename);
  while (parent !== root) {
    const stat = await fsp.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Linked directory in update');
    const next = path.dirname(parent);
    if (next === parent) throw new Error('Invalid update parent');
    parent = next;
  }
}
async function extractArchive(filename, destination, { signal, onProgress = () => {}, limits = LIMITS } = {}) {
  checkAbort(signal);
  const root = path.resolve(destination);
  await fsp.mkdir(root, { recursive: true });
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid extraction directory');
  const zip = await new Promise((resolve, reject) => yauzl.open(filename, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  let zipError = null, declaredBytes = 0, actualBytes = 0, count = 0;
  const files = [], paths = new Map();
  zip.on('error', error => { zipError = error; });
  function nextEntry() {
    if (zipError) return Promise.reject(zipError);
    return new Promise((resolve, reject) => {
      function done(error, entry) { zip.removeListener('entry', entryReady); zip.removeListener('end', ended); zip.removeListener('error', failed); error ? reject(error) : resolve(entry); }
      const entryReady = entry => done(null, entry), ended = () => done(null, null), failed = error => done(error);
      zip.once('entry', entryReady); zip.once('end', ended); zip.once('error', failed); zip.readEntry();
    });
  }
  try {
    if (zip.entryCount < 1 || zip.entryCount > limits.entries) throw new Error('Archive entry limit exceeded');
    for (;;) {
      checkAbort(signal);
      const entry = await nextEntry(); if (!entry) break;
      if (++count > limits.entries) throw new Error('Archive entry limit exceeded');
      const relative = safeRelative(entry.fileName), isDirectory = entry.fileName.endsWith('/');
      const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error('Links and special files are forbidden');
      if ((unixType === 0x4000 && !isDirectory) || (unixType === 0x8000 && isDirectory) || (entry.generalPurposeBitFlag & 1)) throw new Error('Invalid or encrypted archive entry');
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > limits.file || entry.uncompressedSize < 0) throw new Error('Archive file size limit exceeded');
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > limits.unpacked || entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.ratio) throw new Error('Archive expansion limit exceeded');
      const key = relative.toLowerCase(), previous = paths.get(key);
      if (previous && !(isDirectory && previous === 'implicit')) throw new Error('Duplicate or conflicting archive path');
      paths.set(key, isDirectory ? 'directory' : 'file');
      const parts = key.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/');
        if (paths.get(parent) === 'file') throw new Error('Archive parent is a file');
        if (!paths.has(parent)) paths.set(parent, 'implicit');
      }
      const target = inside(root, relative);
      if (isDirectory) {
        if (entry.uncompressedSize !== 0) throw new Error('Directory contains unexpected data');
        await fsp.mkdir(target, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await assertRegularParents(root, target);
        const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value)));
        let size = 0, crc = 0;
        const hash = crypto.createHash('sha256');
        const verify = new Transform({ transform(chunk, _encoding, callback) {
          size += chunk.length; actualBytes += chunk.length;
          if (size > entry.uncompressedSize || size > limits.file || actualBytes > limits.unpacked) return callback(new Error('Inflated archive exceeds declared size'));
          hash.update(chunk); crc = crc32(chunk, crc); callback(null, chunk);
        } });
        await pipeline(stream, verify, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), ...(signal ? [{ signal }] : []));
        if (size !== entry.uncompressedSize || crc !== entry.crc32) throw new Error('Archive CRC or length mismatch');
        files.push({ path: relative, size, sha256: hash.digest('hex') });
      }
      onProgress({ completed: count, entries: zip.entryCount, bytes: actualBytes });
    }
    return files;
  } finally { zip.close(); }
}

async function walkFiles(root, signal, maxEntries = LIMITS.entries) {
  const files = [];
  async function walk(directory, prefix = '') {
    checkAbort(signal);
    const stat = await fsp.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Linked installation directory');
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Linked installation file');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile()) { files.push(relative); if (files.length > maxEntries) throw new Error('Installation file limit exceeded'); }
      else throw new Error('Special installation file');
    }
  }
  await walk(root);
  return files;
}
module.exports = { APP_DIRECTORY, LIMITS, crc32, safeRelative, inside, hashFile, checkAbort, extractArchive, walkFiles };
