import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { createCoopSession, COOP_PROTOCOL, COOP_TICK_RATE, COOP_SNAPSHOT_RATE } from '../src/coop-session.js';

export async function createCoopServer({ host = '127.0.0.1', port = 0, token = randomBytes(32).toString('hex'), version = '1.3.0',
  listen = true, sessionOptions = {}, authorizeJoin, onJoined = () => {}, onDeparture = () => {}, onJoinFailed = () => {},
  onFatal = () => {}, startOptions } = {}) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new Error('Einladungstoken muss 32 Bytes als Hex enthalten.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Ungültiger Serverport.');
  const secret = Buffer.from(token, 'hex');
  const session = createCoopSession(sessionOptions);
  const connections = new Map();
  let closing = false, failed = false, closePromise, snapshotSeq = 0;
  function fatal(error) { if (!failed) { failed = true; onFatal(error); } }
  const tickSamples = [];
  function metrics() {
    const cutoff = performance.now() - 10000, recent = tickSamples.filter(sample => sample.at >= cutoff);
    const ordered = recent.map(sample => sample.ms).sort((a, b) => a - b);
    const elapsed = recent.length > 1 ? (recent.at(-1).at - recent[0].at) / 1000 : 0;
    return { phase: session.phase, tickSamples: recent.length, tickP95Ms: ordered.length ? +ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * .95))].toFixed(2) : 0,
      ticksPerSecond: elapsed > 0 ? +((recent.length - 1) / elapsed).toFixed(1) : 0 };
  }
  const http = createServer((request, response) => {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(request.url === '/health' ? { game: 'DEAD FREQUENCY', protocol: COOP_PROTOCOL, version, phase: session.phase } : { message: 'Koop-Verbindung im Spiel öffnen.' }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN || !message) return false;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1008, 'Connection too slow'); return false; }
    ws.send(JSON.stringify(message)); return true;
  }
  const failure = (ws, message) => send(ws, { type: 'error', message });
  function broadcastLobby() { const message = { ...session.lobby(), ...(startOptions ? { difficulty: startOptions.difficulty } : {}) }; for (const [ws, info] of connections) if (info.id) send(ws, message); }
  function depart(info, reason) {
    if (!info.id || info.departed) return;
    info.departed = true;
    try { session.leave(info.id, reason); onDeparture(info.id, info.identity); }
    catch (error) { fatal(error); }
  }
  function snapshots(only) {
    if (failed) return; // Never acknowledge a profile/result whose durable write failed.
    snapshotSeq++;
    for (const [ws, info] of connections) {
      if (!info.id || (only && ws !== only)) continue;
      const snapshot = session.snapshot(info.id);
      if (snapshot) send(ws, { ...snapshot, tick: snapshot.seq, seq: snapshotSeq });
    }
  }
  function handleUpgrade(request, socket, head) {
    socket.on('error', () => {});
    let allowed = false;
    try {
      const url = new URL(request.url, 'http://localhost');
      const supplied = url.searchParams.get('token');
      allowed = url.pathname === '/coop' && /^[a-f0-9]{64}$/i.test(supplied ?? '') && timingSafeEqual(secret, Buffer.from(supplied, 'hex'));
    } catch { /* Malformed request is denied below. */ }
    if (!allowed || closing || wss.clients.size >= (authorizeJoin ? (sessionOptions.maxPlayers ?? 2) + 2 : 2)) {
      socket.end(`HTTP/1.1 ${!allowed ? '401 Unauthorized' : '503 Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  }
  http.on('upgrade', handleUpgrade);
  wss.on('connection', ws => {
    const info = { id: null, joining: false, count: 0, windowAt: performance.now(), alive: true };
    connections.set(ws, info);
    const joinDeadline = setTimeout(() => { if (!info.id) ws.close(1008, 'Join timeout'); }, 10000);
    joinDeadline.unref?.();
    ws.on('pong', () => { info.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(joinDeadline); connections.delete(ws);
      if (info.id) { depart(info); broadcastLobby(); snapshots(); }
    });
    ws.on('message', async (data, binary) => {
      if (closing) return;
      const now = performance.now();
      if (now - info.windowAt > 1000) { info.windowAt = now; info.count = 0; }
      if (++info.count > 180) { failure(ws, 'Zu viele Nachrichten.'); ws.close(1008, 'Rate limit'); return; }
      if (binary) { failure(ws, 'Nur JSON-Nachrichten werden unterstützt.'); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch { failure(ws, 'Ungültige JSON-Nachricht.'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { failure(ws, 'Ungültige Nachricht.'); return; }
      try {
        if (message.type === 'ping') { send(ws, { type: 'pong', time: Number.isFinite(message.time) ? message.time : 0 }); return; }
        if (message.type === 'join') {
          if (info.id || info.joining) throw new Error('Du bist bereits in dieser Lobby.');
          if (message.protocol !== COOP_PROTOCOL) { failure(ws, 'Die Koop-Protokollversion stimmt nicht überein.'); ws.close(1008, 'Protocol mismatch'); return; }
          if (message.version !== undefined && String(message.version) !== String(version)) { failure(ws, 'Beide Spieler benötigen dieselbe Spielversion.'); ws.close(1008, 'Version mismatch'); return; }
          info.joining = true;
          try {
            const admission = authorizeJoin ? authorizeJoin(message) : { name: message.name, profile: message.profile, kit: message.kit, weapon: message.weapon, loadout: message.loadout };
            info.identity = admission.identity;
            info.id = await session.join(admission);
            onJoined(info.id, info.identity);
          } catch (error) {
            if (info.identity) onJoinFailed(info.identity);
            if (authorizeJoin) ws.close(1008, 'Invalid admission');
            throw error;
          }
          finally { info.joining = false; }
          if (closing || ws.readyState !== WebSocket.OPEN) {
            depart(info);
            if (!closing) { broadcastLobby(); snapshots(); }
            return;
          }
          clearTimeout(joinDeadline);
          send(ws, { type: 'welcome', id: info.id, hostId: session.hostId, protocol: COOP_PROTOCOL, version });
          broadcastLobby(); snapshots(ws); return;
        }
        if (!info.id) throw new Error('Zuerst der Koop-Lobby beitreten.');
        if (message.type === 'ready') { session.ready(info.id, message.ready, message.kit, message.weapon, message.loadout); broadcastLobby(); }
        else if (message.type === 'start') {
          try { session.start(info.id, startOptions ?? { difficulty: message.difficulty }); }
          catch (error) { if (session.phase === 'finished') { failure(ws, 'Der Einsatz konnte nicht gespeichert werden.'); fatal(error); } throw error; }
          broadcastLobby(); snapshots();
        }
        else if (message.type === 'input') session.input(info.id, message.seq, message.input);
        else if (message.type === 'action') session.action(info.id, message.action, message.id, message.containerId);
        else if (message.type === 'leave') {
          depart(info, 'Einsatz verlassen'); snapshots(ws);
          send(ws, { type: 'closed', message: 'Koop-Sitzung verlassen.' }); ws.close(1000, 'Left session');
          broadcastLobby(); snapshots();
        } else throw new Error('Unbekannter Nachrichtentyp.');
      } catch (error) { failure(ws, error.message || 'Koop-Aktion fehlgeschlagen.'); }
    });
  });
  if (listen) await new Promise((resolve, reject) => {
    const onError = error => { http.removeListener('listening', onListen); reject(error); };
    const onListen = () => { http.removeListener('error', onError); resolve(); };
    http.once('error', onError); http.once('listening', onListen); http.listen(port, host);
  });
  let previous = performance.now(), accumulated = 0, snapshotTime = 0, idlePhase = 'lobby';
  const timer = setInterval(() => {
    if (closing) return;
    const now = performance.now(), elapsed = Math.min(.25, Math.max(0, (now - previous) / 1000)); previous = now;
    if (session.phase !== 'raid') {
      if (idlePhase !== session.phase) { snapshots(); idlePhase = session.phase; }
      accumulated = 0; snapshotTime = 0; return;
    }
    idlePhase = null;
    accumulated = Math.min(.25, accumulated + elapsed); snapshotTime += elapsed;
    try {
      while (accumulated >= 1 / COOP_TICK_RATE) {
        const start = performance.now(); session.update(1 / COOP_TICK_RATE);
        tickSamples.push({ at: performance.now(), ms: performance.now() - start }); if (tickSamples.length > 1200) tickSamples.shift();
        accumulated -= 1 / COOP_TICK_RATE;
      }
      if (snapshotTime >= 1 / COOP_SNAPSHOT_RATE) { snapshotTime %= 1 / COOP_SNAPSHOT_RATE; snapshots(); }
    } catch (error) { fatal(error); }
  }, 8);
  const heartbeat = setInterval(() => {
    for (const [ws, info] of connections) {
      if (!info.alive) { ws.terminate(); continue; }
      info.alive = false; ws.ping();
    }
  }, 15000);
  timer.unref?.(); heartbeat.unref?.();
  return { port: http.address()?.port ?? 0, token, session, handleUpgrade, metrics,
    disconnect(id, reason = 'Einsatz verlassen') {
      for (const [ws, info] of connections) if (info.id === id) {
        depart(info, reason); snapshots(ws); send(ws, { type: 'closed', message: reason }); ws.close(1000, 'Left session');
      }
      broadcastLobby(); snapshots();
    },
    close() {
      if (closePromise) return closePromise;
      closing = true; clearInterval(timer); clearInterval(heartbeat);
      for (const info of connections.values()) depart(info, 'Host hat die Sitzung beendet');
      snapshots();
      for (const ws of connections.keys()) {
        send(ws, { type: 'closed', message: failed ? 'Der Server konnte den Einsatz nicht speichern. Bereits verbrauchte Ausrüstung bleibt verloren.' : 'Der Host hat die Koop-Sitzung beendet.' }); ws.close(1001, failed ? 'Server persistence failed' : 'Host closed session');
      }
      try { session.close(); } catch (error) { fatal(error); }
      closePromise = new Promise(resolve => {
        const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); }, 400);
        wss.close(() => { clearTimeout(force); if (http.listening) { http.close(() => resolve()); http.closeIdleConnections?.(); } else resolve(); });
      });
      return closePromise;
    } };
}
