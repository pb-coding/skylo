const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const { io, httpServer, startServer } = require('../src/server');
const { allGames } = require('../src/game/game');
const { acknowledge } = require('../src/game/sessionValidation');
let url;
const clients = [];
const waitFor = async (predicate) => {
  const until = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for server state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const client = async () => {
  const socket = connect(url, { transports: ['websocket'], reconnection: false });
  clients.push(socket);
  await once(socket, 'connect');
  return socket;
};
const request = (socket, event, payload) => new Promise((resolve, reject) =>
  socket.timeout(2_000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)));

before(async () => {
  await startServer(0, '127.0.0.1');
  url = `http://127.0.0.1:${httpServer.address().port}`;
});
after(async () => {
  clients.forEach(socket => socket.disconnect());
  allGames.slice().forEach(game => game.dispose());
  await new Promise(resolve => io.close(resolve));
});

test('reject malformed joins, callback values and private socket room collisions without crashing', async () => {
  const a = await client();
  for (const value of [null, {}, [], 42, '', 'a'.repeat(41), ' room', '../room', '__proto__']) {
    assert.equal(await request(a, 'join-session', value), 'error:invalid');
  }
  assert.equal(await request(a, 'join-session', a.id), 'error:invalid');
  a.emit('join-session', null, true);
  a.emit('create-offer', null);
  a.emit('answer-call', false);
  a.emit('ice-candidate', []);
  assert.equal(await request(a, 'join-session', 'valid-room'), 'success');
  assert.equal(await request(a, 'new-game', null), 'error:invalid');
  assert.equal(await request(a, 'leave-session', 'valid-room'), 'success');
  assert.equal(await request(a, 'join-session', 'Küchentisch'), 'success');
  assert.equal(await request(a, 'leave-session', 'Küchentisch'), 'success');
});

test('one session per socket, idempotent join, host permission, minimum players and active-game guard', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  assert.equal(await request(host, 'join-session', 'game-room'), 'success');
  assert.equal(await request(host, 'join-session', 'game-room'), 'success');
  assert.equal(await request(host, 'join-session', 'other-room'), 'error:joined');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'error:players');
  assert.equal(await request(outsider, 'new-game', { sessionId: 'game-room' }), 'error:membership');
  assert.equal(await request(guest, 'join-session', 'game-room'), 'success');
  assert.equal(await request(guest, 'new-game', { sessionId: 'game-room' }), 'error:host');
  const update = once(host, 'game-update');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'success');
  const [game] = await update;
  assert.equal(game.players.length, 2);
  const original = allGames.find(game => game.sessionId === 'game-room');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'error:running');
  assert.equal(allGames.find(game => game.sessionId === 'game-room'), original);
  assert.equal(await request(outsider, 'join-session', 'game-room'), 'error:running');
  assert.equal(await request(outsider, 'leave-session', 'game-room'), 'error:membership');
  assert.equal(await request(guest, 'leave-session', 'game-room'), 'success');
  await waitFor(() => !allGames.includes(original));
  assert.equal(original.socket.listenerCount('click-card'), 0);
  assert.equal(await request(host, 'leave-session', 'game-room'), 'success');
});

test('eight-player cap and host handoff are based on session membership', async () => {
  const players = await Promise.all(Array.from({ length: 9 }, client));
  for (const socket of players.slice(0, 8)) assert.equal(await request(socket, 'join-session', 'full-room'), 'success');
  assert.equal(await request(players[8], 'join-session', 'full-room'), 'error:full');
  const newHost = once(players[1], 'session-state');
  assert.equal(await request(players[0], 'leave-session', 'full-room'), 'success');
  const [state] = await newHost;
  assert.equal(state.hostId, players[1].id);
  assert.equal(state.maxPlayers, 8);
  assert.equal(await request(players[8], 'join-session', 'full-room'), 'success');
  for (const socket of players.slice(1)) assert.equal(await request(socket, 'leave-session', 'full-room'), 'success');
});

test('unrelated disconnect cannot overwrite lobby counts; member disconnect updates count and host', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  const counts = [];
  guest.on('clients-in-session', value => counts.push(value));
  assert.equal(await request(host, 'join-session', 'presence-room'), 'success');
  assert.equal(await request(guest, 'join-session', 'presence-room'), 'success');
  await waitFor(() => counts.includes(2));
  const outsiderId = outsider.id;
  outsider.disconnect();
  // An ACK on the member's connection gives a barrier after the outsider's
  // server-side disconnection, instead of relying on a long timing assertion.
  await waitFor(() => !io.sockets.sockets.has(outsiderId));
  assert.equal(await request(guest, 'join-session', 'presence-room'), 'success');
  await waitFor(() => counts.length >= 2);
  assert.ok(counts.every(value => value === 2));
  const statePromise = once(guest, 'session-state');
  host.disconnect();
  const [state] = await statePromise;
  assert.equal(state.hostId, guest.id);
  assert.equal(counts.at(-1), 1);
  assert.equal(await request(guest, 'leave-session', 'presence-room'), 'success');
});

test('signaling validates shape, session membership, size and optional peer targets', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  await request(host, 'join-session', 'voice-room');
  await request(guest, 'join-session', 'voice-room');
  const received = [];
  guest.on('offer-made', value => received.push(value));
  const valid = { type: 'offer', sdp: 'test-offer' };
  outsider.emit('create-offer', { sessionName: 'voice-room', offerDescription: valid });
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: { type: 'answer', sdp: 'bad' } });
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: { type: 'offer', sdp: 'x'.repeat(32_769) } });
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: valid, to: outsider.id });
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: valid, to: guest.id });
  await waitFor(() => received.length === 1);
  assert.deepEqual(received, [valid]);
  // Valid legacy broadcast stays compatible with the current two-player chat.
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: valid });
  await waitFor(() => received.length === 2);
  await request(host, 'leave-session', 'voice-room');
  await request(guest, 'leave-session', 'voice-room');
});


test('control requests are bounded and an acknowledgement failure does not escape the handler', async () => {
  const socket = await client();
  for (let index = 0; index < 60; index++) {
    assert.equal(await request(socket, 'join-session', 'bounded-room'), 'success');
  }
  assert.equal(await request(socket, 'join-session', 'bounded-room'), 'error:invalid');
  // Represents a failed transport callback; functions cannot be sent as
  // ordinary client payloads through Socket.IO.
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    assert.doesNotThrow(() => acknowledge(() => { throw new Error('transport closed'); }, 'success'));
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalError;
  }
  socket.disconnect();
});
