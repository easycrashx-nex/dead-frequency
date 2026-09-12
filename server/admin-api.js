import { createHash } from 'node:crypto';
import { AccountError } from './account-store.js';
import { allowedOrigin, clientIP, readJSON, send } from './account-api.js';
import { PERSISTENT_ADMIN_ACTIONS, validateAdminAction } from './admin-store.js';

const fail = (status, code, message) => { throw new AccountError(status, code, message); };
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
const publicAdmin = admin => ({ admin: { username: admin.username }, expiresAt: admin.expiresAt });
const fingerprint = (action, payload) => createHash('sha256').update(JSON.stringify({ action, payload: Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');

export function createAdminApi({ store, rooms, version = '1.14.0', now = Date.now, onError = () => {} } = {}) {
  const limits = new Map(), requests = new Map();
  function throttle(key, maximum, windowMs) {
    const time = now();
    if (limits.size >= 10000) for (const [id, value] of limits) if (value.until <= time) limits.delete(id);
    if (limits.size >= 10000 && !limits.has(key)) fail(429, 'admin_rate_limit', 'Zu viele Anfragen. Bitte später erneut versuchen.');
    let value = limits.get(key);
    if (!value || value.until <= time) { value = { count: 0, until: time + windowMs }; limits.set(key, value); }
    if (++value.count > maximum) fail(429, 'admin_rate_limit', 'Zu viele Admin-Versuche. Bitte später erneut versuchen.');
  }
  const player = value => ({ ...value, room: rooms?.publicStatus?.(value.id) ?? null });
  function pruneRequests() {
    for (const [key, value] of requests) if (value.expiresAt <= now()) requests.delete(key);
  }
  function forgetSession(sessionId) {
    for (const [key, value] of requests) if (value.sessionId === sessionId) requests.delete(key);
  }
  async function act(admin, body) {
    try {
      if (!exact(body, ['action', 'payload', 'requestId']) || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) fail(400, 'invalid_admin_request', 'Aktion, Parameter und eindeutige Anfrage-ID erforderlich.');
      validateAdminAction(body.action, body.payload);
    } catch (error) {
      try { store.record(admin, body?.action, body?.payload?.userId ?? body?.payload?.roomId, 'failed'); } catch (auditError) { onError(auditError); }
      throw error;
    }
    pruneRequests();
    const key = `${admin.sessionId}:${body.requestId}`, signature = fingerprint(body.action, body.payload), cached = requests.get(key);
    if (cached) {
      if (cached.signature !== signature) fail(409, 'request_id_conflict', 'Diese Anfrage-ID gehört bereits zu einer anderen Aktion.');
      return cached.promise;
    }
    if (requests.size >= 2000) fail(429, 'admin_request_capacity', 'Zu viele Admin-Aktionen. Bitte nach Ablauf älterer Sitzungen erneut versuchen.');
    const entry = { signature, sessionId: admin.sessionId, expiresAt: admin.expiresAt, promise: null };
    // Reserve before awaiting any room action, including concurrent HTTP retries.
    requests.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      const target = body.payload.userId ?? body.payload.roomId;
      try {
        let result;
        if (PERSISTENT_ADMIN_ACTIONS.has(body.action)) {
          result = store.perform(admin, body.action, body.payload);
          if (['account-ban', 'sessions-revoke'].includes(body.action) && rooms?.publicStatus?.(body.payload.userId)) {
            // Banning is durable first; closing the existing socket cannot roll
            // back a ban or resurrect a revoked game session.
            await rooms.adminAction('kick', { userId: body.payload.userId });
          }
          result.player = player(result.player);
        } else {
          if (!rooms?.adminAction) fail(503, 'admin_runtime_unavailable', 'Raid-Verwaltung ist nicht verfügbar.');
          result = await rooms.adminAction(body.action, body.payload);
          store.record(admin, body.action, target, 'success');
        }
        return { ok: true, requestId: body.requestId, result };
      } catch (error) {
        try { store.record(admin, body.action, target, 'failed'); } catch (auditError) { onError(auditError); }
        throw error;
      }
    });
    return entry.promise;
  }
  return async function handle(req, res) {
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return false; }
    if (!path.startsWith('/api/admin/')) return false;
    try {
      const origin = req.headers.origin;
      if (!allowedOrigin(origin)) fail(403, 'origin_denied', 'Dieser Ursprung ist nicht erlaubt.');
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      if (path === '/api/admin/login') {
        if (req.method !== 'POST') fail(405, 'method_not_allowed', 'POST erforderlich.');
        throttle(`login:${clientIP(req)}`, 10, 15 * 60_000);
        const body = await readJSON(req);
        if (!exact(body, ['username', 'password'])) fail(400, 'invalid_admin_credentials', 'Adminname und Passwort erforderlich.');
        send(res, 200, await store.login(body.username, body.password)); return true;
      }
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
      const admin = token ? store.authenticate(token) : null;
      if (!admin) fail(401, 'admin_unauthorized', 'Bitte als Administrator anmelden.');
      throttle(`admin:${admin.id}`, 180, 60_000);
      if (['/api/admin/me', '/api/admin/overview', '/api/admin/catalog'].includes(path)) {
        if (req.method !== 'GET') fail(405, 'method_not_allowed', 'GET erforderlich.');
        if (path.endsWith('/me')) send(res, 200, publicAdmin(admin));
        else if (path.endsWith('/catalog')) send(res, 200, { items: store.catalog(), version });
        else send(res, 200, { ...publicAdmin(admin), server: { version, ...(rooms?.adminOverview?.() ?? {}) }, audit: store.audit() });
        return true;
      }
      if (req.method !== 'POST') fail(405, 'method_not_allowed', 'POST erforderlich.');
      const body = await readJSON(req);
      // A request can spend seconds receiving its body while its original
      // session is logged out, expires or is revoked by credential rotation.
      if (!store.authenticate(token)) fail(401, 'admin_unauthorized', 'Bitte als Administrator anmelden.');
      if (path === '/api/admin/logout') {
        if (!exact(body, [])) fail(400, 'invalid_admin_request', 'Ungültige Anfrage.');
        store.logout(token); forgetSession(admin.sessionId); send(res, 200, { ok: true });
      } else if (path === '/api/admin/player') {
        if (!exact(body, ['username'])) fail(400, 'invalid_admin_request', 'Genauen Rufnamen angeben.');
        send(res, 200, { player: player(store.lookupPlayer(body.username)) });
      } else if (path === '/api/admin/action') {
        throttle(`action:${admin.id}`, 60, 60_000);
        send(res, 200, await act(admin, body));
      } else fail(404, 'admin_not_found', 'Unbekannter Admin-Endpunkt.');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const known = error instanceof AccountError || Number.isInteger(error.status) && (error.status >= 400 && error.status < 500 || error.status === 503);
        if (!known) onError(error);
        const status = known ? error.status : 500;
        if (status === 429) res.setHeader('Retry-After', '60');
        send(res, status, { error: known ? error.message : 'Admin-Aktion fehlgeschlagen. Bitte erneut versuchen.', code: known ? error.code ?? 'admin_request_failed' : 'admin_server_error' });
      }
    }
    return true;
  };
}
