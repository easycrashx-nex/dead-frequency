import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { COOP_PROTOCOL } from '../src/coop-session.js';
import { createAccountStore } from './account-store.js';
import { createAccountApi } from './account-api.js';
import { createAdminStore } from './admin-store.js';
import { createAdminApi } from './admin-api.js';
import { createRoomService } from './rooms.js';

export async function startDedicatedServer({ host = '127.0.0.1', port = 8080,
  publicOrigin = process.env.PUBLIC_ORIGIN, dataPath = process.env.DATA_PATH ?? './data/accounts.sqlite',
  maxRooms = Number(process.env.MAX_ROOMS ?? 2), version = packageInfo.version,
  onError = error => console.error('Serverfehler:', error.message) } = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Der Dienst muss hinter dem TLS-Proxy an Loopback gebunden sein.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Ungültiger Port.');
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN muss die öffentliche HTTPS-Adresse enthalten.');
  const path = resolve(dataPath); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const store = createAccountStore({ path });
  let rooms, http, closed, admins;
  try {
    store.recoverRooms();
    rooms = createRoomService({ store, publicOrigin, version, maxRooms, onError });
    const api = createAccountApi({ store, rooms, version });
    admins = createAdminStore({ path, accounts: store });
    const adminApi = createAdminApi({ store: admins, rooms, version, onError });
    http = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ game: 'DEAD FREQUENCY', service: 'dedicated', status: 'ok', version, protocol: COOP_PROTOCOL, rooms: rooms.size, simulation: rooms.metrics() }));
        return;
      }
      Promise.resolve(adminApi(request, response)).then(handled => handled || api(request, response)).then(handled => {
        if (!handled && !response.writableEnded) { response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ message: 'Endpunkt nicht gefunden.' })); }
      }).catch(error => {
        onError(error);
        if (!response.headersSent) { response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ message: 'Serveraktion fehlgeschlagen.' })); }
        else response.destroy();
      });
    });
    http.requestTimeout = 20000; http.headersTimeout = 10000; http.keepAliveTimeout = 5000;
    http.maxHeadersCount = 50;
    http.on('upgrade', (request, socket, head) => { socket.on('error', () => {}); rooms.handleUpgrade(request, socket, head); });
    await new Promise((accept, reject) => {
      http.once('error', reject); http.listen(port, host, () => { http.removeListener('error', reject); accept(); });
    });
    return { port: http.address().port, version,
      close() {
        closed ??= Promise.resolve().then(async () => {
          await rooms.close();
          await new Promise(accept => { http.close(accept); http.closeIdleConnections(); });
          admins.close(); store.close();
        });
        return closed;
      },
    };
  } catch (error) { await rooms?.close(); admins?.close(); store.close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startDedicatedServer({ port: Number(process.env.PORT ?? 8080) });
    console.log(`DEAD FREQUENCY ${server.version} bereit auf 127.0.0.1:${server.port}`);
    let stopping = false;
    const shutdown = () => {
      if (stopping) return; stopping = true;
      const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
      server.close().then(() => { clearTimeout(deadline); process.exit(0); }, error => { console.error('Serverstopp fehlgeschlagen:', error.message); process.exit(1); });
    };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { console.error('Serverstart fehlgeschlagen:', error.message); process.exitCode = 1; }
}
