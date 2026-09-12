const fs = require('node:fs');
const path = require('node:path');

const ONLINE_ORIGIN = 'https://91.98.64.49';
const ROUTES = new Map([
  ['/api/me', 'GET'], ['/api/auth/register', 'POST'], ['/api/auth/login', 'POST'],
  ['/api/auth/logout', 'POST'], ['/api/action', 'POST'], ['/api/rooms', 'GET'],
  ['/api/rooms/create', 'POST'], ['/api/rooms/join', 'POST'], ['/api/rooms/leave', 'POST'],
]);

// Only this fixed service receives the session. Renderer code never gets its token.
function createOnlinePlatform({ userData, safeStorage, request = fetch }) {
  const sessionPath = path.join(userData, 'online-session.enc');
  let token = null, authGeneration = 0;
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(sessionPath)) {
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionPath)));
      if (saved.origin === ONLINE_ORIGIN && /^[a-f0-9]{64}$/.test(saved.token)) token = saved.token;
    }
  } catch { /* An unavailable Windows account key requires a fresh login. */ }
  function clear() {
    token = null;
    try { fs.unlinkSync(sessionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function remember(value) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Ungültige Serverantwort.');
    token = value;
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
      fs.mkdirSync(userData, { recursive: true });
      const encrypted = safeStorage.encryptString(JSON.stringify({ origin: ONLINE_ORIGIN, token }));
      fs.writeFileSync(`${sessionPath}.tmp`, encrypted, { mode: 0o600 });
      fs.renameSync(`${sessionPath}.tmp`, sessionPath);
      return true;
    } catch { return false; }
  }
  async function performRequest(route, options = {}) {
    if (!ROUTES.has(route) || !options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Ungültige Online-Anfrage.');
    const method = options.method ?? ROUTES.get(route);
    if (method !== ROUTES.get(route)) throw new Error('Ungültige Online-Methode.');
    const auth = route === '/api/auth/login' || route === '/api/auth/register';
    const requestToken = token;
    const generation = auth ? ++authGeneration : authGeneration;
    if (!auth && !token) { const error = new Error('Bitte zuerst anmelden.'); error.status = 401; throw error; }
    const body = method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined;
    if (body && Buffer.byteLength(body) > 32768) throw new Error('Online-Anfrage ist zu groß.');
    let response;
    try {
      response = await request(`${ONLINE_ORIGIN}${route}`, {
        method, body, redirect: 'error', cache: 'no-store', credentials: 'omit',
        signal: AbortSignal.timeout(25000),
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(!auth && requestToken ? { Authorization: `Bearer ${requestToken}` } : {}) },
      });
    } catch { throw new Error('Spielserver nicht erreichbar. Prüfe deine Internetverbindung.'); }
    const reader = response.body?.getReader();
    const chunks = []; let length = 0;
    if (reader) for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) { await reader.cancel(); throw new Error('Serverantwort ist zu groß.'); }
      chunks.push(Buffer.from(value));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw new Error('Ungültige Serverantwort.'); }
    if (!response.ok) {
      if (response.status === 401 && !auth && token === requestToken) clear();
      const error = new Error(typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : 'Online-Aktion fehlgeschlagen.');
      error.status = response.status; throw error;
    }
    const { token: receivedToken, ...publicData } = data;
    if (auth) {
      if (generation !== authGeneration) throw new Error('Dieser Anmeldeversuch ist nicht mehr aktuell.');
      publicData.sessionPersistent = remember(receivedToken);
    }
    return publicData;
  }
  async function onlineRequest(route, options = {}) {
    if (route !== '/api/auth/logout') return performRequest(route, options);
    const logoutToken = token;
    authGeneration++;
    // Local logout remains available after expiry or loss of network access.
    try { if (token) await performRequest(route, options); return { ok: true }; }
    catch { return { ok: true, revoked: false }; }
    finally { if (token === logoutToken) clear(); }
  }
  return { onlineRequest };
}
module.exports = { createOnlinePlatform, ONLINE_ORIGIN };
