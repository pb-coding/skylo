const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const { io, httpServer, startServer } = require('../src/server');
const { allGames } = require('../src/game/game');
const { acknowledge } = require('../src/game/sessionValidation');
const { verifyRecord } = require('../src/game/recording');
let url;
const clients = [];
const waitFor = async (predicate, timeout = 2_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for server state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const client = async () => {
  const socket = connect(url, { transports: ['websocket'], reconnection: false, autoConnect: false });
  socket.on('session-state', state => { socket.sessionSnapshot = state; });
  socket.on('game-update', state => { socket.gameSnapshot = state; });
  clients.push(socket);
  socket.connect();
  await once(socket, 'connect');
  return socket;
};
const request = (socket, event, payload) => new Promise((resolve, reject) =>
  socket.timeout(2_000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)));
const join = async (socket, sessionId, role = 'player') => {
  const code = await request(socket, 'join-session', { sessionId, role });
  assert.equal(code, 'success');
  await waitFor(() => socket.sessionSnapshot?.sessionId === sessionId);
  return socket.sessionSnapshot;
};
const bot = (socket, sessionId, difficulty = 'medium', strategyId = 'rules') =>
  request(socket, 'add-bot', { sessionId, config: { strategyId, difficulty } });
const control = (socket, sessionId, command) => request(socket, 'playback-control', { sessionId, command });
const actionRequest = (view, action = view.legalActions[0], requestId = `action-${view.revision}`) => ({
  sessionId: view.sessionId, matchId: view.matchId, requestId, decisionId: view.decisionId, action,
});

before(async () => {
  await startServer(0, '127.0.0.1');
  url = `http://127.0.0.1:${httpServer.address().port}`;
});
afterEach(async () => {
  clients.splice(0).forEach(socket => socket.disconnect());
  allGames.slice().forEach(game => game.stop());
  await waitFor(() => io.sockets.sockets.size === 0);
});
after(async () => {
  await new Promise(resolve => io.close(resolve));
});

test('reject malformed joins, callbacks and socket-room collisions without crashing', async () => {
  const socket = await client();
  for (const value of [null, {}, [], 42, '', 'a'.repeat(41), ' room', '../room', '__proto__',
    { sessionId: 'valid', role: 'admin' }, { sessionId: 'valid', name: {} }]) {
    assert.equal(await request(socket, 'join-session', value), 'error:invalid');
  }
  assert.equal(await request(socket, 'join-session', socket.id), 'error:invalid');
  socket.emit('join-session', null, true);
  socket.emit('create-offer', null);
  socket.emit('answer-call', false);
  socket.emit('ice-candidate', []);
  assert.equal(await request(socket, 'join-session', 'valid-room'), 'success');
  assert.equal(await request(socket, 'new-game', null), 'error:invalid');
  assert.equal(await request(socket, 'leave-session', 'valid-room'), 'success');
  assert.equal(await request(socket, 'join-session', 'Küchentisch'), 'success');
  assert.equal(await request(socket, 'leave-session', 'Küchentisch'), 'success');
});

test('one room per socket, stable identities, idempotent join and game-start authorization', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  const state = await join(host, 'game-room');
  assert.equal(state.hostId, state.ownParticipantId);
  assert.notEqual(state.ownParticipantId, host.id);
  assert.ok(state.ownPlayerId);
  assert.equal(await request(host, 'join-session', 'game-room'), 'success');
  assert.equal(host.sessionSnapshot.ownParticipantId, state.ownParticipantId);
  assert.equal(await request(host, 'join-session', 'other-room'), 'error:joined');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'error:players');
  assert.equal(await request(outsider, 'new-game', { sessionId: 'game-room' }), 'error:membership');
  await join(guest, 'game-room');
  assert.equal(await request(guest, 'new-game', { sessionId: 'game-room' }), 'error:host');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room', seed: 'hidden-seed' }), 'error:invalid');
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'success');
  await waitFor(() => host.gameSnapshot && guest.gameSnapshot);
  assert.equal(host.gameSnapshot.players.length, 2);
  assert.equal(host.gameSnapshot.ownPlayerId, state.ownPlayerId);
  assert.equal(guest.gameSnapshot.ownPlayerId, guest.sessionSnapshot.ownPlayerId);
  const original = allGames.find(game => game.sessionId === 'game-room');
  assert.ok(original);
  assert.equal(await request(host, 'new-game', { sessionId: 'game-room' }), 'error:running');
  assert.equal(allGames.find(game => game.sessionId === 'game-room'), original);
  assert.equal(await request(outsider, 'join-session', 'game-room'), 'error:running');
  assert.equal(await request(outsider, 'leave-session', 'game-room'), 'error:membership');
  assert.equal(await request(guest, 'leave-session', 'game-room'), 'success');
  await waitFor(() => !allGames.includes(original));
  assert.equal(original.disposed, true);
});

test('human and bot seats share the eight-player cap, while spectators consume no seats', async () => {
  const host = await client();
  const spectator = await client();
  const extraPlayer = await client();
  await join(host, 'full-room');
  for (let index = 0; index < 7; index++) assert.equal(await bot(host, 'full-room'), 'success');
  await waitFor(() => host.sessionSnapshot.players.length === 8);
  assert.equal(await bot(host, 'full-room'), 'error:full');
  assert.equal(await request(extraPlayer, 'join-session', 'full-room'), 'error:full');
  const viewer = await join(spectator, 'full-room', 'spectator');
  assert.equal(viewer.players.length, 8);
  assert.equal(viewer.participants.length, 2);
  assert.equal(viewer.ownPlayerId, null);
  assert.equal(viewer.role, 'spectator');
  assert.equal(viewer.canControl, false);
  const botId = viewer.players.find(player => player.kind === 'bot').id;
  assert.equal(await request(host, 'remove-bot', { sessionId: 'full-room', playerId: botId }), 'success');
  assert.equal(await request(extraPlayer, 'join-session', 'full-room'), 'success');
  await waitFor(() => host.sessionSnapshot.players.length === 8);
  assert.equal(await request(spectator, 'set-role', { sessionId: 'full-room', role: 'player' }), 'error:full');
});

test('two-player strategies remain visible but cannot start after a third player joins', async () => {
  const { registerBotStrategy, RandomBot } = require('../src/game/bots');
  const { GameRunner } = require('../src/game/runtime/GameRunner');
  const unregister = registerBotStrategy({ id: 'two-player-test', version: '1', name: 'Zweispieler-Test',
    supportedPlayerCounts: [2], factory: () => Object.assign(new RandomBot(), { id: 'two-player-test' }) });
  try {
    const host = await client(), guest = await client();
    await join(host, 'two-player-only');
    assert.equal(await bot(host, 'two-player-only', 'medium', 'two-player-test'), 'success');
    await waitFor(() => host.sessionSnapshot.players.length === 2);
    assert.equal(host.sessionSnapshot.botCatalog.find(entry => entry.id === 'two-player-test').available, true);
    await join(guest, 'two-player-only');
    await waitFor(() => host.sessionSnapshot.players.length === 3);
    const entry = host.sessionSnapshot.botCatalog.find(entry => entry.id === 'two-player-test');
    assert.equal(entry.available, false);
    assert.match(entry.unavailableReason, /2 Spieler/);
    assert.equal(await request(host, 'new-game', { sessionId: 'two-player-only' }), 'error:players');
    assert.throws(() => new GameRunner({matchId:'invalid-count',sessionId:'test',seed:'test',
      players:host.sessionSnapshot.players}), /2 Spieler/);
    assert.equal(await request(guest, 'leave-session', 'two-player-only'), 'success');
    await waitFor(() => host.sessionSnapshot.players.length === 2);
    assert.equal(host.sessionSnapshot.botCatalog.find(entry => entry.id === 'two-player-test').available, true);
    assert.equal(await request(host, 'new-game', { sessionId: 'two-player-only' }), 'success');
  } finally { unregister(); }
});

test('host can change roles and bot configuration only in the lobby', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  await join(host, 'bot-lobby');
  await join(guest, 'bot-lobby', 'spectator');
  assert.equal(await bot(guest, 'bot-lobby'), 'error:host');
  assert.equal(await bot(outsider, 'bot-lobby'), 'error:membership');
  for (const config of [null, {}, { strategyId: 'unknown', difficulty: 'medium' },
    { strategyId: 'rules', difficulty: 'expert' }, { strategyId: 'rules', difficulty: 'easy', version: 'wrong' }]) {
    assert.equal(await request(host, 'add-bot', { sessionId: 'bot-lobby', config }), 'error:invalid');
  }
  assert.equal(await bot(host, 'bot-lobby'), 'success');
  await waitFor(() => host.sessionSnapshot.players.some(player => player.kind === 'bot'));
  const playerId = host.sessionSnapshot.players.find(player => player.kind === 'bot').id;
  assert.equal(await request(host, 'update-bot', { sessionId: 'bot-lobby', playerId,
    config: { strategyId: 'random', difficulty: 'easy' } }), 'success');
  await waitFor(() => host.sessionSnapshot.players.find(player => player.id === playerId).botConfig.strategyId === 'random');
  assert.equal(await request(guest, 'remove-bot', { sessionId: 'bot-lobby', playerId }), 'error:host');
  assert.equal(await request(host, 'remove-bot', { sessionId: 'bot-lobby', playerId: host.sessionSnapshot.ownPlayerId }), 'error:invalid');
  assert.equal(await request(host, 'set-role', { sessionId: 'bot-lobby', role: 'spectator' }), 'success');
  await waitFor(() => host.sessionSnapshot.role === 'spectator');
  assert.equal(host.sessionSnapshot.canControl, true);
  assert.equal(await bot(host, 'bot-lobby', 'hard'), 'success');
  assert.equal(await request(host, 'new-game', { sessionId: 'bot-lobby', seed: 'compare' }), 'success');
  for (const [event, payload] of [
    ['add-bot', { sessionId: 'bot-lobby', config: { strategyId: 'rules', difficulty: 'easy' } }],
    ['remove-bot', { sessionId: 'bot-lobby', playerId }],
    ['update-bot', { sessionId: 'bot-lobby', playerId, config: { strategyId: 'rules', difficulty: 'hard' } }],
    ['set-role', { sessionId: 'bot-lobby', role: 'player' }],
  ]) assert.equal(await request(host, event, payload), 'error:running');
});

test('spectators can join midgame, see redacted state and cannot act or control', async () => {
  const host = await client();
  const guest = await client();
  const viewer = await client();
  const outsider = await client();
  await join(host, 'watch-room');
  await join(guest, 'watch-room');
  assert.equal(await request(host, 'new-game', { sessionId: 'watch-room' }), 'success');
  await waitFor(() => host.gameSnapshot);
  assert.equal(await request(host, 'game-action', actionRequest(host.gameSnapshot)), 'success');
  await join(viewer, 'watch-room', 'spectator');
  await waitFor(() => viewer.gameSnapshot);
  const snapshot = viewer.gameSnapshot;
  assert.equal(snapshot.role, 'spectator');
  assert.equal(snapshot.ownPlayerId, null);
  assert.equal(snapshot.decisionId, null);
  assert.deepEqual(snapshot.legalActions, []);
  assert.ok(snapshot.cardStack.cards.every(card => card === null));
  for (const player of snapshot.players) player.deck.forEach((column, x) => column.forEach((card, y) => {
    if (!player.knownCardPositions[x][y]) assert.equal(card, null);
  }));
  assert.equal('seed' in snapshot, false);
  const current = host.gameSnapshot;
  const runner = allGames.find(game => game.sessionId === 'watch-room');
  const fingerprint = runner.core.fingerprint();
  assert.equal(await request(viewer, 'game-action', actionRequest(current)), 'error:membership');
  assert.equal(await request(outsider, 'game-action', actionRequest(current)), 'error:membership');
  assert.equal(await control(viewer, 'watch-room', { type: 'pause' }), 'error:host');
  assert.equal(await control(guest, 'watch-room', { type: 'pause' }), 'error:host');
  assert.equal(await control(outsider, 'watch-room', { type: 'pause' }), 'error:membership');
  assert.equal(runner.core.fingerprint(), fingerprint);
  const viewerId = viewer.id;
  viewer.disconnect();
  await waitFor(() => !io.sockets.sockets.has(viewerId));
  assert.equal(runner.disposed, false);
  assert.equal(allGames.includes(runner), true);
});

test('network action tokens reject stale requests and duplicate acknowledgements cannot replay a move', async () => {
  const host = await client();
  const guest = await client();
  await join(host, 'action-room');
  await join(guest, 'action-room');
  await request(host, 'new-game', { sessionId: 'action-room' });
  await waitFor(() => host.gameSnapshot);
  const oldView = host.gameSnapshot;
  const move = actionRequest(oldView, oldView.legalActions[0], 'same-request');
  assert.equal(await request(host, 'game-action', move), 'success');
  await waitFor(() => host.gameSnapshot.revision === oldView.revision + 1);
  const revision = host.gameSnapshot.revision;
  assert.equal(await request(host, 'game-action', move), 'success');
  assert.equal(await request(host, 'game-action', { ...move, requestId: 'late', action: oldView.legalActions[1] }), 'error:stale');
  assert.equal(await request(host, 'game-action', { ...move, action: oldView.legalActions[1] }), 'error:invalid');
  assert.equal(host.gameSnapshot.revision, revision);
  assert.equal(await request(host, 'game-action', actionRequest(host.gameSnapshot, host.gameSnapshot.legalActions[0], 'fresh')), 'success');
});

test('spectator host controls pause and speed, exports a completed bot match and replays it', async () => {
  const host = await client();
  const guest = await client();
  await join(host, 'bot-match', 'spectator');
  await join(guest, 'bot-match', 'spectator');
  assert.equal(await bot(host, 'bot-match', 'easy'), 'success');
  assert.equal(await bot(host, 'bot-match', 'hard'), 'success');
  assert.equal(await request(host, 'new-game', { sessionId: 'bot-match', seed: 'socket-regression' }), 'success');
  await waitFor(() => host.gameSnapshot);
  assert.equal(await control(host, 'bot-match', { type: 'pause' }), 'success');
  assert.equal(await request(host, 'export-match', { sessionId: 'bot-match' }).then(result => result.code), 'error:running');
  assert.equal(await request(guest, 'stop-match', { sessionId: 'bot-match' }), 'error:host');
  assert.equal(await request(guest, 'export-match', { sessionId: 'bot-match' }).then(result => result.code), 'error:host');
  const before = host.gameSnapshot.revision;
  assert.equal(await control(host, 'bot-match', { type: 'step-action' }), 'success');
  await waitFor(() => host.gameSnapshot.revision === before + 1);
  assert.equal(host.gameSnapshot.playback.paused, true);
  assert.equal(await control(host, 'bot-match', { type: 'delay', delayMs: 0 }), 'success');
  assert.equal(await control(host, 'bot-match', { type: 'resume' }), 'success');
  await waitFor(() => host.gameSnapshot.phase === 'game ended', 15_000);
  await waitFor(() => host.sessionSnapshot.hasExport && !host.sessionSnapshot.running);
  const exported = await request(host, 'export-match', { sessionId: 'bot-match' });
  assert.equal(exported.code, 'success');
  assert.equal(exported.record.config.seed, 'socket-regression');
  assert.equal(exported.record.config.players.length, 2);
  assert.ok(exported.record.actions.length > 4);
  const replay = verifyRecord(exported.record);
  assert.equal(replay.valid, true, replay.error);
  assert.equal(allGames.some(game => game.sessionId === 'bot-match'), false);
});

test('spectator host handoff leaves bot play running and promotes a human participant', async () => {
  const host = await client();
  const viewer = await client();
  await join(host, 'handoff-room', 'spectator');
  const viewerState = await join(viewer, 'handoff-room', 'spectator');
  await bot(host, 'handoff-room');
  await bot(host, 'handoff-room');
  await request(host, 'new-game', { sessionId: 'handoff-room', seed: 'handoff' });
  const runner = allGames.find(game => game.sessionId === 'handoff-room');
  assert.ok(runner);
  host.disconnect();
  await waitFor(() => viewer.sessionSnapshot.hostId === viewerState.ownParticipantId);
  assert.equal(viewer.sessionSnapshot.canControl, true);
  assert.equal(viewer.sessionSnapshot.ownPlayerId, null);
  assert.equal(runner.disposed, false);
  assert.equal(await control(viewer, 'handoff-room', { type: 'pause' }), 'success');
  assert.equal(await request(viewer, 'stop-match', { sessionId: 'handoff-room' }), 'success');
  assert.equal(runner.disposed, true);
});

test('unobserved bot matches survive viewer disconnect and can be rejoined', async () => {
  const host = await client();
  await join(host, 'return-room', 'spectator');
  await bot(host, 'return-room');
  await bot(host, 'return-room');
  await request(host, 'new-game', { sessionId: 'return-room', seed: 'return' });
  assert.equal(await control(host, 'return-room', { type: 'pause' }), 'success');
  const runner = allGames.find(game => game.sessionId === 'return-room');
  const hostSocketId = host.id;
  host.disconnect();
  await waitFor(() => !io.sockets.sockets.has(hostSocketId));
  assert.equal(runner.disposed, false);
  const returningViewer = await client();
  const state = await join(returningViewer, 'return-room', 'spectator');
  await waitFor(() => returningViewer.gameSnapshot);
  assert.equal(state.hostId, state.ownParticipantId);
  assert.equal(state.canControl, true);
  assert.equal(state.running, true);
  assert.equal(returningViewer.gameSnapshot.matchId, runner.matchId);
  assert.equal(returningViewer.gameSnapshot.playback.paused, true);
  assert.equal(await request(returningViewer, 'stop-match', { sessionId: 'return-room' }), 'success');
});

test('unrelated disconnect does not alter presence; player disconnect updates host and stops match', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  await join(host, 'presence-room');
  const guestState = await join(guest, 'presence-room');
  const originalHost = guest.sessionSnapshot.hostId;
  const outsiderId = outsider.id;
  outsider.disconnect();
  await waitFor(() => !io.sockets.sockets.has(outsiderId));
  assert.equal(await request(guest, 'join-session', 'presence-room'), 'success');
  assert.equal(guest.sessionSnapshot.hostId, originalHost);
  assert.equal(guest.sessionSnapshot.participants.length, 2);
  await request(host, 'new-game', { sessionId: 'presence-room' });
  const runner = allGames.find(game => game.sessionId === 'presence-room');
  host.disconnect();
  await waitFor(() => guest.sessionSnapshot.hostId === guestState.ownParticipantId);
  assert.equal(guest.sessionSnapshot.participants.length, 1);
  assert.equal(runner.disposed, true);
  assert.equal(allGames.includes(runner), false);
});

test('signaling validates shape, membership, size and optional peer targets', async () => {
  const host = await client();
  const guest = await client();
  const outsider = await client();
  await join(host, 'voice-room');
  await join(guest, 'voice-room');
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
  host.emit('create-offer', { sessionName: 'voice-room', offerDescription: valid });
  await waitFor(() => received.length === 2);
});

test('control flooding is bounded and acknowledgement failures stay inside the handler', async () => {
  const socket = await client();
  for (let index = 0; index < 60; index++) {
    assert.equal(await request(socket, 'join-session', 'bounded-room'), 'success');
  }
  assert.equal(await request(socket, 'join-session', 'bounded-room'), 'error:invalid');
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    assert.doesNotThrow(() => acknowledge(() => { throw new Error('transport closed'); }, 'success'));
    assert.equal(errors.length, 1);
  } finally { console.error = originalError; }
});

test('malformed game-action flooding remains bounded without changing game state', async () => {
  const host = await client();
  const guest = await client();
  await join(host, 'flood-room');
  await join(guest, 'flood-room');
  await request(host, 'new-game', { sessionId: 'flood-room' });
  const runner = allGames.find(game => game.sessionId === 'flood-room');
  const fingerprint = runner.core.fingerprint();
  const replies = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Action limiter did not acknowledge its bound')), 2_000);
    for (let index = 0; index < 200; index++) host.emit('game-action', null, code => {
      replies.push(code);
      if (code === 'error:rate-limited') { clearTimeout(timeout); resolve(); }
    });
  });
  assert.ok(replies.length <= 61);
  assert.equal(replies.at(-1), 'error:rate-limited');
  assert.equal(runner.core.fingerprint(), fingerprint);
});

test('repeated network starts and stops leave no runner or per-match socket listeners', async () => {
  const host = await client();
  const guest = await client();
  await join(host, 'restart-room');
  await join(guest, 'restart-room');
  const serverSocket = io.sockets.sockets.get(host.id);
  const events = serverSocket.eventNames().map(event => [event, serverSocket.listenerCount(event)]);
  for (let index = 0; index < 20; index++) {
    assert.equal(await request(host, 'new-game', { sessionId: 'restart-room' }), 'success');
    const runner = allGames.find(game => game.sessionId === 'restart-room');
    assert.ok(runner);
    assert.equal(await request(host, 'stop-match', { sessionId: 'restart-room' }), 'success');
    assert.equal(runner.disposed, true);
    assert.equal(allGames.includes(runner), false);
    assert.deepEqual(serverSocket.eventNames().map(event => [event, serverSocket.listenerCount(event)]), events);
  }
});

test('server catalog exposes Jev profiles and validates them; socket decisions retain model/fallback metadata', async () => {
  const { registerBotStrategy } = require('../src/game/bots');
  const { JevBot } = require('../src/game/bots/jev');
  const { JevProvider, MemoryRequestLedger } = require('../src/game/bots/jevProvider');
  let calls = 0;
  const provider = new JevProvider({ model:'jev-1.13.0',timeoutMs:5000,maxRequests:10,maxRequestsPerMatch:1,concurrency:1,failureThreshold:2,cooldownMs:60000 },new MemoryRequestLedger(),'socket-fixture-key',async(_url,init)=>{
    calls++;
    const ids=Object.keys(JSON.parse(init.body).questions.action.criteria);
    return new Response(JSON.stringify({ model:'jev-1.13.0',usage:{ input_tokens:100,output_tokens:20 },answers:{ action:{ type:'choice',choice:ids[0],confidence:0.9,probabilities:Object.fromEntries(ids.map(id=>[id,id===ids[0]?1:0])) } } }),{ headers:{ 'content-type':'application/json' } });
  });
  const unregister=registerBotStrategy({ id:'typesafe-jev-choice',version:'socket-fixture',name:'Jev · TypeSafe',profiles:[{ id:'choice',name:'Jev Choice' }],factory:()=>{
    const strategy=new JevBot(provider);Object.defineProperty(strategy,'version',{ value:'socket-fixture' });return strategy;
  } });
  try {
    const host=await client();const sessionId='jev-socket-room';const lobby=await join(host,sessionId,'spectator');
    const catalog=lobby.botCatalog.find(entry=>entry.id==='typesafe-jev-choice');
    assert.equal(catalog.available,true);assert.deepEqual(catalog.difficulties,[]);assert.deepEqual(catalog.profiles,[{ id:'choice',name:'Jev Choice' }]);assert.equal(calls,0);
    for(const config of [{ strategyId:'typesafe-jev-choice',profile:'missing' },{ strategyId:'typesafe-jev-choice',profile:'choice',difficulty:'medium' },{ strategyId:'typesafe-jev-choice',profile:'choice',apiKey:'evil' },{ strategyId:'typesafe-jev-choice',profile:'choice',model:'evil' }])
      assert.equal(await request(host,'add-bot',{ sessionId,config }),'error:invalid');
    assert.equal(await request(host,'add-bot',{ sessionId,config:{ strategyId:'typesafe-jev-choice',profile:'choice' } }),'success');
    assert.equal(await bot(host,sessionId),'success');assert.equal(calls,0);
    assert.equal(await request(host,'new-game',{ sessionId }),'success');assert.equal(await control(host,sessionId,{ type:'pause' }),'success');
    await waitFor(()=>host.gameSnapshot?.playback.paused && !host.gameSnapshot.playback.thinking);
    const revision=host.gameSnapshot.revision;
    assert.equal(await control(host,sessionId,{ type:'delay',delayMs:0 }),'success');
    assert.equal(await control(host,sessionId,{ type:'step-action' }),'success');
    await waitFor(()=>host.gameSnapshot?.revision===revision+1);
    assert.equal(host.gameSnapshot.lastDecision.diagnostics.source,'model');assert.equal(calls,1);
    assert.equal(await control(host,sessionId,{ type:'step-action' }),'success');
    await waitFor(()=>host.gameSnapshot?.revision===revision+2);
    assert.equal(host.gameSnapshot.lastDecision.fallback,true);assert.equal(host.gameSnapshot.lastDecision.diagnostics.failure,'budget-exhausted');assert.equal(calls,1);
    assert.equal(await request(host,'stop-match',{ sessionId }),'success');
    const exported=await request(host,'export-match',{ sessionId });assert.equal(exported.code,'success');assert.equal(verifyRecord(exported.record).valid,true);assert.equal(calls,1);
  } finally { unregister(); }
});
