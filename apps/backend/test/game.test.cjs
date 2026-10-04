const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { EventEmitter } = require('node:events');

// The game engine is exercised without opening a port or importing the live server.
const sockets = new Map();
const rooms = new Map();
const emitted = [];
const serverPath = require.resolve('../src/server.ts');
require.cache[serverPath] = { id: serverPath, filename: serverPath, loaded: true, exports: {
  io: {
    sockets: { sockets, adapter: { rooms } },
    to: (room) => ({ emit: (event, data) => emitted.push({ room, event, data }) }),
  },
} };
const { Game, allGames } = require('../src/game/game.ts');

beforeEach(() => {
  for (const game of [...allGames]) game.dispose();
  sockets.clear(); rooms.clear(); emitted.length = 0;
});
function fixture() {
  for (const id of ['a', 'b']) sockets.set(id, new EventEmitter());
  rooms.set('session:table', new Set(['a', 'b']));
  const game = new Game(sockets.get('a'), 'table', rooms.get('session:table'));
  allGames.push(game);
  return game;
}
function snapshot(game) {
  return JSON.stringify({ players: game.players, pile: game.discardPile, stack: game.cardStack.cards, phase: game.phase, round: game.round });
}
function turn(game, phase) {
  game.phase = phase;
  game.players.forEach((player, index) => { player.playersTurn = index === 0; });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('malformed and out-of-range reveals leave the entire game unchanged', () => {
  const game = fixture();
  for (const payload of [null, {}, '0,0', [], [0], [0, 0, 0], [-1, 0], [999, 0], [0, 3], [0, -1], [0.5, 0], [NaN, 0], [Infinity, 0], ['0', 0]]) {
    const before = snapshot(game);
    assert.equal(game.revealCardAction('a', payload), false);
    assert.equal(snapshot(game), before);
  }
  assert.equal(game.revealCardAction('outsider', [0, 0]), false);
});

test('initial reveals are unique and limited to two per player', () => {
  const game = fixture();
  assert.equal(game.revealCardAction('a', [0, 0]), true);
  assert.equal(game.revealCardAction('a', [0, 0]), false);
  assert.equal(game.revealCardAction('a', [0, 1]), true);
  assert.equal(game.revealCardAction('a', [0, 2]), false);
  assert.equal(game.players[0].getRevealedCardCount(), 2);
});

test('invalid placement preserves the cached card and piles, including zero-valued cards', () => {
  const game = fixture(); turn(game, 'place card'); game.players[0].cardCache = 0;
  for (const payload of [null, {}, [-1, 0], [4, 0], [0, 3], [0, 0.1]]) {
    const before = snapshot(game);
    assert.equal(game.placeCardAction('a', payload), false);
    assert.equal(snapshot(game), before);
  }
  const replaced = game.players[0].deck[0][0];
  assert.equal(game.placeCardAction('a', [0, 0]), true);
  assert.equal(game.players[0].deck[0][0], 0);
  assert.equal(game.discardPile.at(-1), replaced);
  assert.equal(game.players[0].cardCache, null);
  assert.equal(game.placeCardAction('a', [0, 0]), false);
});

test('actions from the wrong player or phase cannot mutate game state', () => {
  const game = fixture(); turn(game, 'pick up card');
  const before = snapshot(game);
  assert.equal(game.drawCardAction('b'), false);
  assert.equal(game.takeDiscardPileAction('b'), false);
  assert.equal(game.placeCardAction('a', [0, 0]), false);
  assert.equal(game.discardCardToPileAction('a'), false);
  assert.equal(game.nextRoundAction('a'), false);
  assert.equal(game.revealCardAction('a', [0, 0]), false);
  assert.equal(snapshot(game), before);
  assert.equal(game.drawCardAction('a'), true);
  const after = snapshot(game);
  assert.equal(game.drawCardAction('a'), false);
  assert.equal(game.takeDiscardPileAction('a'), false);
  assert.equal(snapshot(game), after);
});

test('empty draw pile refills from discards while preserving the visible top and card count', () => {
  const game = fixture(); turn(game, 'pick up card');
  game.cardStack.cards = []; game.discardPile = [0, 1, 2, 3];
  assert.equal(game.drawCardAction('a'), true);
  assert.deepEqual(game.discardPile, [3]);
  assert.deepEqual([...game.cardStack.cards, game.players[0].cardCache].sort(), [0, 1, 2]);
});

test('empty piles reject pickup without advancing or producing undefined cards', () => {
  const game = fixture(); turn(game, 'pick up card');
  game.cardStack.cards = []; game.discardPile = [0];
  let before = snapshot(game);
  assert.equal(game.drawCardAction('a'), false);
  assert.equal(snapshot(game), before);
  game.discardPile = []; before = snapshot(game);
  assert.equal(game.takeDiscardPileAction('a'), false);
  assert.equal(snapshot(game), before);
});

test('discard-picked card must be placed; discard flags persist until a valid placement', async () => {
  const game = fixture(); turn(game, 'pick up card');
  assert.equal(game.takeDiscardPileAction('a'), true);
  const placing = game.placeCard();
  assert.equal(game.players[0].tookDispiledCard, true);
  assert.equal(sockets.get('a').listenerCount('click-discard-pile'), 0);
  assert.equal(game.discardCardToPileAction('a'), false);
  sockets.get('a').emit('click-card', [0, 0]);
  await placing;
  assert.equal(game.phase, 'pick up card');
  assert.equal(game.players[0].tookDispiledCard, false);
});

test('hidden equal columns remain; multiple visible triples remove the right columns and conserve cards', () => {
  const game = fixture(); const player = game.players[0];
  player.deck = [[1,1,1], [2,2,2], [3,4,5], [6,6,6]];
  player.knownCardPositions = [[false,false,false], [true,true,true], [true,false,true], [true,true,true]];
  const pileSize = game.discardPile.length;
  game.removeThreeOfAKinds();
  assert.deepEqual(player.deck, [[1,1,1], [3,4,5]]);
  assert.deepEqual(player.knownCardPositions, [[false,false,false], [true,false,true]]);
  assert.equal(game.discardPile.length, pileSize + 6);
  assert.deepEqual(game.discardPile.slice(pileSize).sort(), [2,2,2,6,6,6]);
});

test('invalid socket actions keep the wait active and safe ACKs do not crash', async () => {
  const game = fixture(); const a = sockets.get('a');
  const waiting = game.waitForPlayerActions([['click-card', game.revealCardAction.bind(game)]], ['a', 'b']);
  let settled = false; waiting.then(() => { settled = true; });
  const replies = [];
  a.emit('click-card', [999,0], (response) => replies.push(response));
  a.emit('click-card', null, true);
  await tick();
  assert.equal(settled, false);
  assert.equal(a.listenerCount('click-card'), 1);
  assert.deepEqual(replies, ['error:invalid-action']);
  a.emit('click-card', [0,0], () => { throw new Error('bad acknowledgement'); });
  assert.deepEqual(await waiting, { playerSocketId: 'a', data: [0,0] });
  assert.equal(a.listenerCount('click-card'), 0);
  assert.equal(sockets.get('b').listenerCount('click-card'), 0);
});

test('dispose resolves waits and cleans listeners even after socket removal; repeated disposal is safe', async () => {
  const game = fixture(); const a = sockets.get('a');
  const waiting = game.waitForPlayerActions([['click-card', game.revealCardAction.bind(game)]], ['a']);
  sockets.delete('a');
  game.dispose(); game.dispose();
  assert.equal(await waiting, null);
  assert.equal(a.listenerCount('click-card'), 0);
  assert.equal(game.phase, 'game ended');
  assert.equal(allGames.includes(game), false);
  assert.equal(await game.waitForPlayerActions([], []), null);
});

test('leaving during initial reveal ends the async loop without registering new listeners', async () => {
  const game = fixture(); const a = sockets.get('a');
  const looping = game.gameLoop();
  rooms.get('session:table').delete('b');
  game.checkForPlayerLeave();
  await looping;
  assert.equal(a.listenerCount('click-card'), 0);
  assert.equal(game.phase, 'game ended');
  assert.equal(allGames.includes(game), false);
  assert.ok(emitted.some(({ event, data }) => event === 'game-update' && data === null));
});

test('point limit is terminal: no next-round wait, no new round, and no unrelated game removal', async () => {
  const game = fixture(); game.phase = 'new round'; game.players[0].totalPoints = 100;
  const other = { dispose() {} }; allGames.push(other);
  await game.gameLoop();
  assert.equal(game.phase, 'game ended');
  assert.equal(game.round, 1);
  assert.equal(sockets.get('a').listenerCount('next-round'), 0);
  assert.equal(game.nextRoundAction('a'), false);
  game.initializeNewRound(); game.checkIfPointLimitReached();
  assert.equal(game.round, 1);
  assert.deepEqual(allGames, [other]);
  allGames.length = 0;
});

test('next round accepts any member once, rejects duplicate requests and outsiders', () => {
  const game = fixture(); game.phase = 'new round';
  assert.equal(game.nextRoundAction('outsider'), false);
  assert.equal(game.nextRoundAction('b'), true);
  assert.equal(game.round, 2);
  assert.equal(game.nextRoundAction('b'), false);
  assert.equal(game.round, 2);
});

test('action flooding is bounded without advancing the phase or amplifying error ACKs', async () => {
  const game = fixture(); const a = sockets.get('a');
  const replies = [];
  const waiting = game.waitForPlayerActions([['click-card', game.revealCardAction.bind(game)]], ['a']);
  for (let i = 0; i < 200; i++) a.emit('click-card', null, (reply) => replies.push(reply));
  assert.equal(replies.length, 61);
  assert.equal(replies.at(-1), 'error:rate-limited');
  assert.equal(game.players[0].getRevealedCardCount(), 0);
  assert.equal(a.listenerCount('click-card'), 1);
  game.dispose(); assert.equal(await waiting, null);
});

test('disposal cancels each phase wait without reviving the game or changing turn/round', async () => {
  for (const [phase, method] of [
    ['pick up card', 'pickUpCard'], ['place card', 'placeCard'],
    ['reveal card', 'revealCard'], ['new round', 'nextRound'],
  ]) {
    const game = fixture(); turn(game, phase);
    const waiting = game[method]();
    game.dispose(); await waiting;
    assert.equal(game.phase, 'game ended');
    assert.equal(game.round, 1);
    assert.equal(game.players[0].playersTurn, true);
    for (const socket of sockets.values()) assert.equal(socket.eventNames().length, 0);
  }
});

test('100 successive starts and disposals retain no listeners on participating sockets', async () => {
  const game = fixture(); const ids = rooms.get('session:table'); const a = sockets.get('a');
  game.dispose();
  for (let i = 0; i < 100; i++) {
    const restarted = new Game(a, 'table', ids);
    allGames.push(restarted);
    const waiting = restarted.waitForPlayerActions([['click-card', restarted.revealCardAction.bind(restarted)]], ['a', 'b']);
    restarted.dispose();
    assert.equal(await waiting, null);
    assert.equal(a.listenerCount('click-card'), 0);
    assert.equal(sockets.get('b').listenerCount('click-card'), 0);
  }
  assert.equal(allGames.length, 0);
});

test('two players complete a round through real action listeners, preserve all 150 cards and start the next round once', async () => {
  const game = fixture();
  for (const player of game.players) player.deck = Array.from({ length: 4 }, () => [0,1,2]);
  const looping = game.gameLoop();
  for (const id of ['a', 'b']) {
    for (const position of [[0,0], [0,1]]) {
      sockets.get(id).emit('click-card', position);
      await tick();
    }
  }
  let actions = 0;
  while (game.phase !== 'new round' && actions++ < 100) {
    const player = game.getPlayersTurn();
    const socket = sockets.get(player.socketId);
    if (game.phase === 'pick up card') socket.emit('draw-from-card-stack', 'draw card');
    else if (game.phase === 'place card') socket.emit('click-discard-pile', 'take discard pile card');
    else if (game.phase === 'reveal card') {
      const column = player.knownCardPositions.findIndex((cards) => cards.includes(false));
      assert.ok(column >= 0);
      socket.emit('click-card', [column, player.knownCardPositions[column].indexOf(false)]);
    } else assert.fail(`Unexpected phase: ${game.phase}`);
    await tick();
    const count = game.cardStack.cards.length + game.discardPile.length +
      game.players.reduce((sum, p) => sum + p.deck.flat().length + (p.cardCache === null ? 0 : 1), 0);
    assert.equal(count, 150);
  }
  assert.equal(game.phase, 'new round');
  assert.deepEqual(game.players.map((player) => player.totalPoints).sort((a,b) => a-b), [12,24]);
  const totals = game.players.map((player) => player.totalPoints);
  sockets.get('b').emit('next-round', { sessionId: 'table' });
  sockets.get('b').emit('next-round', { sessionId: 'table' });
  await tick();
  assert.equal(game.round, 2);
  assert.equal(game.phase, 'reveal two cards');
  assert.deepEqual(game.players.map((player) => player.totalPoints), totals);
  game.dispose(); await looping;
});
