import { isIP } from 'node:net';
import { AccountError } from './account-store.js';

const BODY_LIMIT = 32 * 1024;
const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const deny = (status, code, message) => { throw new AccountError(status, code, message); };
function allowedOrigin(origin) {
  if (origin === undefined || origin === 'null') return true;
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === origin; }
  catch { return false; }
}
function clientIP(req) {
  const peer = req.socket.remoteAddress ?? 'unknown';
  // The service binds to loopback behind the TLS proxy. A direct remote client cannot
  // choose a forwarded address; use the last hop appended by the trusted proxy.
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim();
    if (isIP(forwarded)) return forwarded;
  }
  return peer;
}
function readJSON(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) deny(415, 'content_type', 'JSON-Anfrage erforderlich.');
  if (Number(req.headers['content-length']) > BODY_LIMIT) { req.resume(); deny(413, 'body_too_large', 'Anfrage ist zu groß.'); }
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { finish(new AccountError(408, 'request_timeout', 'Anfrage hat zu lange gedauert.')); req.resume(); }, 10000);
    timer.unref?.();
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_LIMIT) { chunks = []; finish(new AccountError(413, 'body_too_large', 'Anfrage ist zu groß.')); req.resume(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
        finish(null, value);
      } catch { finish(new AccountError(400, 'invalid_json', 'Ungültige JSON-Anfrage.')); }
    });
    req.on('aborted', () => finish(new AccountError(400, 'aborted', 'Anfrage abgebrochen.')));
    req.on('error', () => finish(new AccountError(400, 'request_error', 'Anfrage konnte nicht gelesen werden.')));
  });
}
const shape = (body, fields) => Object.keys(body).every(key => fields.includes(key));

export function createAccountApi({ store, rooms, version = '1.13.0', now = Date.now } = {}) {
  const limits = new Map(), presence = new Map();
  const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  const shortText = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
  function seen(id) {
    const time = now();
    for (const [key, at] of presence) {
      if (time - at < 45000) break;
      presence.delete(key);
    }
    presence.delete(id); presence.set(id, time);
    while (presence.size > 10000) presence.delete(presence.keys().next().value);
  }
  function publicRoom(id) {
    // Never use status(): the owner's private room state contains its invite URL.
    const value = rooms?.publicStatus?.(id);
    if (!value) return null;
    const result = {};
    for (const key of ['roomId', 'mode', 'phase', 'visibility', 'playerCount', 'maxPlayers', 'difficulty', 'version', 'createdAt', 'joinable']) {
      if (['string', 'number', 'boolean'].includes(typeof value[key])) result[key] = value[key];
    }
    if (value.host) result.host = { id: value.host.id, username: value.host.username };
    if (Array.isArray(value.players)) result.players = value.players.map(player => ({ id: player.id, username: player.username }));
    return result;
  }
  function socialFor(user) {
    const social = store.social(user.id);
    return { ...social, friends: social.friends.map(friend => {
      const room = publicRoom(friend.id);
      const status = room?.phase === 'raid' ? 'raid' : room?.phase === 'lobby' ? 'lobby' : room || now() - (presence.get(friend.id) ?? -Infinity) < 45000 ? 'online' : 'offline';
      return { ...friend, status, room };
    }), invitations: rooms?.invitations?.(user) ?? [] };
  }
  function throttle(key, maximum, windowMs) {
    const time = now();
    if (limits.size > 10000) {
      for (const [id, value] of limits) if (value.until <= time) limits.delete(id);
      if (limits.size > 10000) deny(429, 'rate_limited', 'Zu viele Anfragen. Bitte später erneut versuchen.');
    }
    let value = limits.get(key);
    if (!value || value.until <= time) { value = { count: 0, until: time + windowMs }; limits.set(key, value); }
    if (++value.count > maximum) deny(429, 'rate_limited', 'Zu viele Versuche. Bitte später erneut versuchen.');
  }
  return async function handle(req, res) {
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return false; }
    if (!path.startsWith('/api/')) return false;
    try {
      const origin = req.headers.origin;
      if (!allowedOrigin(origin)) deny(403, 'origin_denied', 'Dieser Ursprung ist nicht erlaubt.');
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      const ip = clientIP(req);
      if (['/api/auth/register', '/api/auth/login'].includes(path)) {
        if (req.method !== 'POST') deny(405, 'method_not_allowed', 'POST erforderlich.');
        const register = path.endsWith('/register');
        throttle(`auth:${ip}`, 20, 15 * 60_000);
        if (register) throttle(`register:${ip}`, 5, 60 * 60_000);
        const body = await readJSON(req);
        if (!shape(body, ['username', 'password'])) deny(400, 'invalid_fields', 'Ungültige Anmeldedaten.');
        const result = await store[register ? 'register' : 'login'](body.username, body.password);
        seen(result.user.id);
        send(res, register ? 201 : 200, result); return true;
      }
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
      const user = token ? store.authenticate(token) : null;
      if (!user) deny(401, 'unauthorized', 'Bitte anmelden.');
      throttle(`account:${user.id}`, 180, 60_000);
      seen(user.id);
      if (['/api/me', '/api/rooms', '/api/social'].includes(path)) {
        if (req.method !== 'GET') deny(405, 'method_not_allowed', 'GET erforderlich.');
        if (path === '/api/social') send(res, 200, socialFor(user));
        else if (path === '/api/rooms') send(res, 200, rooms?.list ? await rooms.list(user) : { room: rooms?.status(user.id) ?? null });
        else send(res, 200, { user, profile: store.getProfile(user.id), room: rooms?.status(user.id) ?? null, version });
        return true;
      }
      if (req.method !== 'POST') deny(405, 'method_not_allowed', 'POST erforderlich.');
      const body = await readJSON(req);
      if (path === '/api/auth/logout') {
        if (!shape(body, [])) deny(400, 'invalid_fields', 'Ungültige Anfrage.');
        store.logout(token); presence.delete(user.id); send(res, 200, { ok: true });
      } else if (path === '/api/action') {
        send(res, 200, await store.action(user.id, body));
      } else if (['/api/friends/request', '/api/friends/respond', '/api/friends/remove'].includes(path)) {
        throttle(`friends:${user.id}`, 20, 60_000);
        let result;
        if (path.endsWith('/request')) {
          if (!shape(body, ['username']) || typeof body.username !== 'string') deny(400, 'invalid_fields', 'Genauen Rufnamen angeben.');
          result = store.requestFriend(user.id, body.username);
        } else {
          const respond = path.endsWith('/respond');
          if (!shape(body, respond ? ['userId', 'accept'] : ['userId']) || !validId(body.userId) || respond && typeof body.accept !== 'boolean') deny(400, 'invalid_fields', 'Ungültige Freundesanfrage.');
          result = respond ? store.respondFriend(user.id, body.userId, body.accept) : store.removeFriend(user.id, body.userId);
        }
        send(res, 200, { ok: true, result, social: socialFor(user) });
      } else if (['/api/rooms/create', '/api/rooms/join', '/api/rooms/leave', '/api/rooms/invite', '/api/rooms/invitation'].includes(path)) {
        if (!rooms) deny(503, 'rooms_unavailable', 'Raid-Server ist noch nicht bereit.');
        const kind = path.split('/').at(-1), fields = {
          create: ['mode', 'loadout', 'difficulty', 'visibility'], join: ['invite', 'roomId', 'loadout'], leave: [],
          invite: ['userId'], invitation: ['invitationId', 'accept', 'loadout'],
        }[kind];
        if (!shape(body, fields)) deny(400, 'invalid_fields', 'Ungültige Lobby-Anfrage.');
        if (body.loadout !== undefined && (!body.loadout || typeof body.loadout !== 'object' || Array.isArray(body.loadout))) deny(400, 'invalid_fields', 'Ungültiges Loadout.');
        if (kind === 'create' && (body.visibility !== undefined && !['public', 'friends'].includes(body.visibility) || body.mode !== undefined && !['solo', 'coop'].includes(body.mode) || body.difficulty !== undefined && !['normal', 'hard'].includes(body.difficulty))) deny(400, 'invalid_fields', 'Ungültige Lobby-Einstellungen.');
        if (kind === 'join' && ((body.roomId === undefined) === (body.invite === undefined) || body.roomId !== undefined && !shortText(body.roomId) || body.invite !== undefined && (typeof body.invite !== 'string' || !body.invite || body.invite.length > 2048))) deny(400, 'invalid_fields', 'Genau eine gültige Lobby oder Einladung angeben.');
        if (kind === 'invite' && !validId(body.userId) || kind === 'invitation' && (!shortText(body.invitationId) || typeof body.accept !== 'boolean')) deny(400, 'invalid_fields', 'Ungültige Teameinladung.');
        throttle(`rooms:${user.id}`, 20, 60_000);
        send(res, 200, await rooms[kind === 'invitation' ? 'respondInvitation' : kind](user, body) ?? { ok: true });
      } else deny(404, 'not_found', 'Unbekannter Endpunkt.');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const known = error instanceof AccountError || Number.isInteger(error.status) && (error.status >= 400 && error.status < 500 || error.status === 503);
        const status = known ? error.status : 500;
        if (status === 429) res.setHeader('Retry-After', '60');
        send(res, status, { error: known ? error.message : 'Serverfehler. Bitte erneut versuchen.', code: known ? error.code ?? 'request_failed' : 'server_error' });
      }
    }
    return true;
  };
}
