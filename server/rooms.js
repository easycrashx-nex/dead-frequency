import { randomBytes, randomUUID } from 'node:crypto';
import { createCoopServer } from './coop-server.js';
import { resolveLoadout } from '../src/loadouts.js';

const clone = value => structuredClone(value);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

// Room invitations select a room; only a short-lived, account-bound ticket admits a player.
export function createRoomService({ store, publicOrigin, version, maxRooms = 2, lobbyTtlMs = 600000,
  ticketTtlMs = 60000, finishedTtlMs = 60000, clock = Date.now, onError = console.error, createRuntime = createCoopServer } = {}) {
  if (!store) throw new Error('Account-Speicher fehlt.');
  const origin = new URL(publicOrigin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') throw new Error('Ungültige Serveradresse.');
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Öffentliche Server benötigen HTTPS.');
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 32) throw new Error('Ungültiges Raumlimit.');
  const socketOrigin = origin.origin.replace(/^http/, 'ws');
  const rooms = new Map(), byToken = new Map(), byAccount = new Map(), tickets = new Map(), friendInvites = new Map();
  let closing = false;

  function userId(user) {
    if (!user || typeof user.id !== 'string' || !user.id || typeof user.username !== 'string') throw fail('Anmeldung erforderlich.', 401);
    return user.id;
  }
  function invitation(room) { return `${socketOrigin}/coop?token=${room.token}`; }
  function available(room) {
    return !closing && room && !room.closing && !room.failed && room.server?.session.phase === 'lobby' && room.mode === 'coop'
      && room.members.size > 0 && room.members.size < 2 && clock() - room.createdAt < lobbyTtlMs;
  }
  function safeSummary(room) {
    const owner = room.members.get(room.ownerId);
    return { roomId: room.id, mode: room.mode, phase: room.failed ? 'error' : room.server?.session.phase ?? 'lobby', visibility: room.visibility,
      host: owner ? { ...owner.user } : null, players: [...room.members.values()].map(member => ({ ...member.user })),
      playerCount: room.members.size, maxPlayers: room.mode === 'solo' ? 1 : 2, difficulty: room.difficulty,
      version, createdAt: room.createdAt, joinable: !!available(room) };
  }
  function revokeRoomInvites(roomId) {
    for (const [id, pending] of friendInvites) if (pending.roomId === roomId) friendInvites.delete(id);
  }
  function mayEnter(room, accountId) {
    return room.ownerId === accountId || room.visibility !== 'friends' || store.areFriends(room.ownerId, accountId);
  }
  function pruneInvites() {
    const now = clock();
    for (const [id, pending] of friendInvites) {
      const room = rooms.get(pending.roomId);
      if (pending.expiresAt <= now || !available(room) || room.ownerId !== pending.fromId
        || room.members.has(pending.userId) || !store.areFriends(pending.fromId, pending.userId)) friendInvites.delete(id);
    }
  }
  function revokeTickets(accountId, roomId) {
    for (const [ticket, admission] of tickets) if (admission.accountId === accountId && admission.roomId === roomId) tickets.delete(ticket);
  }
  function removeMember(room, accountId) {
    const member = room.members.get(accountId);
    if (!member) return;
    revokeTickets(accountId, room.id);
    if (room.ownerId === accountId) revokeRoomInvites(room.id);
    // A failed raid remains visible until its durable spent-state lock can be released.
    if (room.failed && !room.aborted) return;
    if (!room.started) store.releaseRoom(accountId, room.id);
    room.members.delete(accountId);
    if (byAccount.get(accountId) === room.id) byAccount.delete(accountId);
    if (room.ownerId === accountId) room.ownerId = room.members.keys().next().value ?? null;
    if (!room.members.size && !room.closing) void destroy(room).catch(onError);
  }
  async function destroy(room) {
    if (room.destroyPromise) return room.destroyPromise;
    room.closing = true;
    revokeRoomInvites(room.id);
    room.destroyPromise = Promise.resolve().then(async () => {
      await room.server?.close();
      if (room.failed && !room.aborted) { store.abortRoom(room.id); room.aborted = true; }
      for (const member of [...room.members.values()]) removeMember(room, member.user.id);
      rooms.delete(room.id); byToken.delete(room.token);
    }).catch(error => {
      // Keep the room and account mapping so a temporary disk fault cannot orphan locks.
      room.destroyPromise = null;
      throw error;
    });
    return room.destroyPromise;
  }
  function claim(room, user, loadout) {
    const id = userId(user);
    if (byAccount.has(id)) throw fail('Du bist bereits in einer Sitzung. Verlasse sie zuerst.');
    const profile = store.acquireRoom(id, room.id);
    try {
      if (profile.intake.length) throw fail('Zuerst die zurückgebrachte Beute im Lager einlagern.');
      const resolved = resolveLoadout(profile, { loadout });
      if (!resolved.valid || !resolved.affordable) throw fail(resolved.reason || 'Nicht genug Credits für dieses Loadout.');
      const member = { user: { id, username: user.username }, loadout: clone(resolved.selection), playerId: null, joining: false,
        expiresAt: clock() + ticketTtlMs, settled: false };
      room.members.set(id, member); byAccount.set(id, room.id);
      return member;
    } catch (error) { store.releaseRoom(id, room.id); throw error; }
  }
  function issue(room, member) {
    const ticket = randomBytes(32).toString('hex');
    tickets.set(ticket, { accountId: member.user.id, roomId: room.id, expiresAt: member.expiresAt });
    return { roomId: room.id, mode: room.mode, visibility: room.visibility, difficulty: room.difficulty,
      phase: room.server.session.phase, invite: invitation(room), url: invitation(room), ticket, expiresAt: member.expiresAt };
  }
  function authorize(room, message) {
    const ticket = typeof message.ticket === 'string' ? message.ticket : '';
    const admission = tickets.get(ticket);
    if (!admission || admission.roomId !== room.id || admission.expiresAt <= clock()) throw fail('Beitrittsticket ungültig oder abgelaufen.', 401);
    tickets.delete(ticket); // Consume synchronously before asynchronous world initialization.
    const member = room.members.get(admission.accountId);
    if (closing || room.closing || !member || member.playerId || member.joining || room.server.session.phase !== 'lobby') throw fail('Dieser Beitritt ist nicht mehr verfügbar.');
    if (!mayEnter(room, member.user.id)) {
      removeMember(room, member.user.id);
      throw fail('Diese Lobby ist nur für Freunde des Hosts verfügbar.', 403);
    }
    member.joining = true;
    return { identity: member.user.id, name: member.user.username, profile: store.getProfile(member.user.id), loadout: member.loadout,
      host: room.ownerId === member.user.id };
  }
  function playerMember(room, playerId) { return [...room.members.values()].find(member => member.playerId === playerId); }
  async function create(user, { mode = 'coop', loadout, difficulty = 'normal', visibility = 'public' } = {}) {
    userId(user);
    if (closing) throw fail('Server wird neu gestartet.', 503);
    if (!['solo', 'coop'].includes(mode) || !['normal', 'hard'].includes(difficulty)) throw fail('Ungültiger Einsatzmodus.', 400);
    if (!['public', 'friends'].includes(visibility)) throw fail('Ungültige Lobby-Sichtbarkeit.', 400);
    if (rooms.size >= maxRooms) throw fail('Alle Einsätze sind momentan belegt. Bitte kurz warten.', 503);
    const room = { id: randomUUID(), token: randomBytes(32).toString('hex'), ownerId: user.id, mode, difficulty,
      visibility: mode === 'solo' ? 'private' : visibility, members: new Map(),
      createdAt: clock(), started: false, closing: false, finishedAt: null, server: null };
    rooms.set(room.id, room); byToken.set(room.token, room);
    try {
      const member = claim(room, user, loadout);
      room.server = await createRuntime({ listen: false, token: room.token, version, compatibleVersions: version === '1.13.0' ? ['1.12.0'] : [], startOptions: { difficulty },
        sessionOptions: {
          minPlayers: mode === 'solo' ? 1 : 2, maxPlayers: mode === 'solo' ? 1 : 2,
          onRaidStart(participants) {
            const profiles = participants.map(player => ({ accountId: playerMember(room, player.id)?.user.id, profile: player.profile }));
            if (profiles.some(player => !player.accountId) || !store.commitRaidStart(room.id, profiles)) throw fail('Einsatz konnte nicht sicher gespeichert werden.');
            room.started = true;
            revokeRoomInvites(room.id);
          },
          onPlayerFinished(playerId, profile, outcome) {
            const owner = playerMember(room, playerId);
            if (!room.started || !owner || owner.settled) return;
            store.settleRaid(owner.user.id, room.id, profile, outcome === 'extracted' ? 'extracted' : 'death');
            owner.settled = true;
            if ([...room.members.values()].every(player => player.settled)) room.finishedAt = clock();
          },
        },
        authorizeJoin: message => authorize(room, message),
        onJoined(playerId, accountId) {
          const owner = room.members.get(accountId);
          if (!owner || room.closing) throw fail('Sitzung wurde geschlossen.');
          if (!mayEnter(room, accountId)) throw fail('Diese Lobby ist nur für Freunde des Hosts verfügbar.', 403);
          owner.playerId = playerId; owner.joining = false;
        },
        onDeparture: (playerId, accountId) => removeMember(room, accountId),
        onJoinFailed: accountId => removeMember(room, accountId),
        onFatal(error) { room.failed = true; onError(error); void destroy(room).catch(onError); },
      });
      if (closing || room.closing) { await room.server.close(); await destroy(room); throw fail('Server wird neu gestartet.', 503); }
      return issue(room, member);
    } catch (error) { await destroy(room); throw error; }
  }
  async function join(user, { roomId, invite, loadout } = {}) {
    userId(user);
    if (closing) throw fail('Server wird neu gestartet.', 503);
    let room;
    if (roomId !== undefined) {
      if (invite !== undefined || typeof roomId !== 'string' || !roomId || roomId.length > 100) throw fail('Bitte genau eine gültige Lobby auswählen.', 400);
      room = rooms.get(roomId);
    } else {
      try {
        const address = new URL(invite);
        if (address.protocol === 'https:') address.protocol = 'wss:';
        if (address.origin !== socketOrigin || address.pathname !== '/coop' || address.username || address.password) throw new Error();
        room = byToken.get(address.searchParams.get('token'));
      } catch { throw fail('Bitte eine gültige Einladung von diesem Server verwenden.', 400); }
    }
    if (!room || room.closing || !room.server || room.mode !== 'coop' || room.server.session.phase !== 'lobby') throw fail('Diese Einladung ist nicht mehr verfügbar.', 404);
    if (!mayEnter(room, user.id)) throw fail('Diese Lobby ist nur für Freunde des Hosts verfügbar.', 403);
    if (room.members.size >= 2) throw fail('Die Sitzung ist voll.');
    if (clock() - room.createdAt >= lobbyTtlMs) throw fail('Diese Lobby ist abgelaufen.', 404);
    const admission = issue(room, claim(room, user, loadout));
    revokeRoomInvites(room.id); // Accepting reserves the last place and invalidates competing invitations.
    return admission;
  }
  function status(accountId) {
    const room = rooms.get(byAccount.get(accountId));
    if (!room || room.closing && !room.failed) return null;
    return { roomId: room.id, mode: room.mode, visibility: room.visibility, host: safeSummary(room).host,
      phase: room.failed ? 'error' : room.server?.session.phase ?? 'lobby', difficulty: room.difficulty,
      invite: invitation(room), players: room.server?.session.lobby().players ?? [] };
  }
  function publicStatus(accountId) {
    const room = rooms.get(byAccount.get(accountId));
    if (!room || room.closing && !room.failed || room.server?.session.phase === 'finished' && !room.failed) return null;
    return safeSummary(room);
  }
  function list(user) {
    userId(user); pruneInvites();
    return { rooms: [...rooms.values()].filter(room => room.visibility === 'public' && available(room)).map(safeSummary),
      room: status(user.id), capacity: { rooms: rooms.size, maxRooms } };
  }
  function invite(user, { userId: recipientId } = {}) {
    const id = userId(user), room = rooms.get(byAccount.get(id));
    pruneInvites();
    if (!available(room) || room.ownerId !== id) throw fail('Nur der Host einer freien Koop-Lobby kann einladen.');
    if (typeof recipientId !== 'string' || !recipientId || recipientId.length > 100 || recipientId === id) throw fail('Bitte einen anderen Freund auswählen.', 400);
    if (room.members.has(recipientId) || !store.areFriends(id, recipientId)) throw fail('Dieser Freund kann nicht eingeladen werden.', 403);
    const existing = [...friendInvites.values()].find(pending => pending.roomId === room.id && pending.userId === recipientId);
    if (existing) existing.expiresAt = clock() + 120000;
    else {
      if (friendInvites.size >= 100) throw fail('Zu viele offene Einladungen. Bitte kurz warten.', 429);
      const invitationId = randomUUID();
      friendInvites.set(invitationId, { id: invitationId, roomId: room.id, fromId: id, userId: recipientId, expiresAt: clock() + 120000 });
    }
    return { ok: true };
  }
  function invitations(user) {
    const id = userId(user); pruneInvites();
    return [...friendInvites.values()].filter(pending => pending.userId === id).map(pending => ({ id: pending.id, roomId: pending.roomId,
      from: { ...rooms.get(pending.roomId).members.get(pending.fromId).user }, expiresAt: pending.expiresAt, difficulty: rooms.get(pending.roomId).difficulty }));
  }
  async function respondInvitation(user, { invitationId, accept, loadout } = {}) {
    const id = userId(user); pruneInvites();
    if (typeof invitationId !== 'string' || !invitationId || invitationId.length > 100 || typeof accept !== 'boolean') throw fail('Ungültige Einladungsantwort.', 400);
    const pending = friendInvites.get(invitationId);
    if (!pending || pending.userId !== id) throw fail('Diese Einladung ist nicht mehr verfügbar.', 404);
    if (!accept) { friendInvites.delete(invitationId); return { ok: true }; }
    const admission = await join(user, { roomId: pending.roomId, loadout });
    friendInvites.delete(invitationId);
    return admission;
  }
  function leave(user) {
    const room = rooms.get(byAccount.get(userId(user)));
    if (!room) return false;
    const member = room.members.get(user.id);
    if (member?.playerId) room.server.disconnect(member.playerId);
    else removeMember(room, user.id);
    return true;
  }
  function handleUpgrade(request, socket, head) {
    let room;
    try { const url = new URL(request.url, origin); if (url.pathname === '/coop') room = byToken.get(url.searchParams.get('token')); } catch { /* Reject below. */ }
    if (closing || !room?.server || room.closing) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    room.server.handleUpgrade(request, socket, head);
  }
  async function sweep() {
    const now = clock();
    pruneInvites();
    for (const [ticket, admission] of tickets) if (admission.expiresAt <= now) tickets.delete(ticket);
    for (const room of [...rooms.values()]) {
      if (room.failed) { await destroy(room); continue; }
      if (!room.started && now - room.createdAt >= lobbyTtlMs || room.finishedAt !== null && now - room.finishedAt >= finishedTtlMs) { await destroy(room); continue; }
      for (const member of [...room.members.values()]) if (!member.playerId && !member.joining && member.expiresAt <= now) removeMember(room, member.user.id);
    }
  }
  const timer = setInterval(() => { sweep().catch(onError); }, 5000); timer.unref?.();
  return { create, join, leave, status, list, publicStatus, invite, invitations, respondInvitation, handleUpgrade, sweep,
    metrics() { return { tickRate: 60, simulations: [...rooms.values()].filter(room => room.server).map(room => room.server.metrics()) }; },
    get size() { return rooms.size; },
    async close() { closing = true; clearInterval(timer); await Promise.all([...rooms.values()].map(destroy)); tickets.clear(); friendInvites.clear(); },
  };
}
