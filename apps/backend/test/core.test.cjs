const assert = require('node:assert/strict');
const { test } = require('node:test');
const { GameCore } = require('../src/game/core/GameCore.ts');
const { createRandom } = require('../src/game/core/random.ts');
const { RULE_VERSION } = require('../src/protocol/gameProtocol.ts');

function fixture(options = {}) {
  const count = options.playerCount ?? 2;
  const players = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, kind: 'human' }));
  return new GameCore({ matchId: 'match', sessionId: 'session', seed: 'test-seed', players, ...options });
}

function cards(core) {
  return [...core.state.cardStack.cards, ...core.state.discardPile,
    ...core.state.players.flatMap((player) => [
      ...player.deck.flat(), ...(player.cardCache === null ? [] : [player.cardCache]),
    ])];
}

function begin(core) {
  while (core.state.phase === 'reveal two cards') {
    const id = core.eligiblePlayerIds()[0];
    assert.equal(core.apply(id, core.legalActions(id)[0]).accepted, true);
  }
}

function active(core, phase = 'pick up card', seat = 0) {
  core.state.phase = phase;
  core.state.activePlayerId = core.state.players[seat].id;
  core.state.players.forEach((player, index) => { player.playersTurn = index === seat; });
  return core.state.players[seat];
}

function setBoard(player, columns, known) {
  player.deck = columns.map((column) => [...column]);
  player.slotIds = player.slotIds.slice(0, columns.length);
  player.knownCardPositions = known ?? columns.map(() => [false, false, false]);
}

function completeTurn(core, player) {
  assert.equal(core.state.activePlayerId, player.id);
  assert.equal(core.apply(player.id, { type: 'draw' }).accepted, true);
  assert.equal(core.apply(player.id, { type: 'discard' }).accepted, true);
  if (core.state.phase === 'reveal card') {
    assert.equal(core.apply(player.id, core.legalActions(player.id)[0]).accepted, true);
  }
}

test('configuration bounds, unique identities and the 150-card pack are validated', () => {
  assert.throws(() => fixture({ playerCount: 1 }));
  assert.throws(() => fixture({ playerCount: 9 }));
  assert.throws(() => fixture({ players: [{ id: 'x', name: 'x', kind: 'human' }, { id: 'x', name: 'y', kind: 'human' }] }));
  for (const maxActions of [0, -1, 0.5, NaN, Infinity, 10_000_001]) assert.throws(() => fixture({ maxActions }));
  const core = fixture({ playerCount: 8 });
  const all = cards(core);
  assert.equal(all.length, 150);
  for (let value = -2; value <= 12; value++) {
    assert.equal(all.filter((card) => card === value).length, value === -2 ? 5 : value === 0 ? 15 : 10);
  }
});

test('fingerprints ignore JSON key order and explicit default limits', () => {
  const first = fixture();
  const other = new GameCore({
    maxActions: 100_000, maxRounds: 100, pointLimit: 100,
    players: [
      { kind: 'human', name: 'Player 0', id: 'p0' },
      { kind: 'human', id: 'p1', name: 'Player 1' },
    ],
    seed: 'test-seed', sessionId: 'session', matchId: 'match',
  });
  assert.equal(first.fingerprint(), other.fingerprint());
  const action = first.legalActions('p0')[0];
  first.apply('p0', action); other.apply('p0', { slotId: action.slotId, type: action.type });
  assert.equal(first.fingerprint(), other.fingerprint());
});

test('initial reveals are unique, limited to two, and invalid actions never mutate anything', () => {
  const core = fixture();
  assert.deepEqual(core.eligiblePlayerIds(), ['p0', 'p1']);
  const slot = core.state.players[0].slotIds[0][0];
  for (const action of [null, {}, [], 'reveal', { type: 'reveal' }, { type: 'draw' },
    { type: 'reveal', slotId: 'missing' }, { type: 'reveal', slotId: slot, extra: {} },
    { type: 'reveal', slotId: 0 }]) {
    const fingerprint = core.fingerprint();
    assert.deepEqual(core.apply('p0', action), { accepted: false, events: [] });
    assert.equal(core.fingerprint(), fingerprint);
  }
  assert.equal(core.apply('outsider', { type: 'reveal', slotId: slot }).accepted, false);
  assert.equal(core.apply('p0', { type: 'reveal', slotId: slot }).accepted, true);
  assert.equal(core.apply('p0', { type: 'reveal', slotId: slot }).accepted, false);
  assert.equal(core.apply('p0', core.legalActions('p0')[0]).accepted, true);
  assert.deepEqual(core.eligiblePlayerIds(), ['p1']);
  assert.equal(core.legalActions('p0').length, 0);
  begin(core);
  assert.equal(core.state.phase, 'pick up card');
  assert.equal(core.eligiblePlayerIds().length, 1);
});

test('live views hide unknown values, expose only visible sums, and share no mutable structures', () => {
  const core = fixture();
  const first = core.state.players[0];
  const initial = core.view();
  assert.equal(initial.ruleVersion, RULE_VERSION);
  assert.ok(initial.cardStack.cards.every((card) => card === null));
  assert.ok(initial.players.every((player) => player.deck.flat().every((card) => card === null)));
  assert.equal('seed' in initial, false);
  assert.equal('actionCount' in initial, false);
  core.apply(first.id, { type: 'reveal', slotId: first.slotIds[0][0] });
  const view = core.view();
  assert.equal(view.players[0].deck[0][0], first.deck[0][0]);
  assert.equal(view.players[0].roundPoints, first.deck[0][0]);
  const fingerprint = core.fingerprint();
  view.players[0].deck[0][0] = 12;
  view.players[0].slotIds[0][0] = 'changed';
  view.players[0].knownCardPositions[0][0] = false;
  view.players[0].name = 'changed';
  view.discardPile.push(12);
  assert.equal(core.fingerprint(), fingerprint);
  begin(core);
  const playerId = core.state.activePlayerId;
  core.apply(playerId, { type: 'draw' });
  assert.equal(core.view().players.find((player) => player.id === playerId).cardCache,
    core.state.players.find((player) => player.id === playerId).cardCache);
});

test('highest visible sum starts; highest visible card resolves equal sums', () => {
  const core = fixture({ playerCount: 3 });
  setBoard(core.state.players[0], [[6, 4, 0], [0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  setBoard(core.state.players[1], [[9, 1, 0], [0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  setBoard(core.state.players[2], [[3, 2, 0], [0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  begin(core);
  assert.equal(core.state.activePlayerId, 'p1');
  assert.equal(core.state.turn, 1);
});

test('wrong player and phase reject draw/place/discard/reveal without changing state', () => {
  const core = fixture(); begin(core);
  const id = core.state.activePlayerId;
  const other = core.state.players.find((player) => player.id !== id);
  const fingerprint = core.fingerprint();
  for (const action of [{ type: 'draw' }, { type: 'take-discard' }, { type: 'discard' }, { type: 'place', slotId: other.slotIds[0][0] }]) {
    assert.equal(core.apply(other.id, action).accepted, false);
  }
  assert.equal(core.apply(id, { type: 'discard' }).accepted, false);
  assert.equal(core.apply(id, { type: 'next-round' }).accepted, false);
  assert.equal(core.fingerprint(), fingerprint);
  assert.equal(core.apply(id, { type: 'draw' }).accepted, true);
  const after = core.fingerprint();
  assert.equal(core.apply(id, { type: 'draw' }).accepted, false);
  assert.equal(core.fingerprint(), after);
});

test('a taken discard must be placed, including zero-valued cards', () => {
  const core = fixture(); const player = active(core);
  core.state.discardPile.push(0);
  assert.equal(core.apply(player.id, { type: 'take-discard' }).accepted, true);
  assert.equal(player.cardCache, 0);
  assert.equal(core.apply(player.id, { type: 'discard' }).accepted, false);
  const replaced = player.deck[0][0];
  assert.equal(core.apply(player.id, { type: 'place', slotId: player.slotIds[0][0] }).accepted, true);
  assert.equal(player.deck[0][0], 0);
  assert.equal(core.state.discardPile.at(-1), replaced);
  assert.equal(player.cardCache, null);
  assert.equal(player.tookDispiledCard, false);
  assert.equal(core.state.activePlayerId, 'p1');
});

test('draw refills preserve visible top, conserve all cards and clone randomness', () => {
  const core = fixture(); const player = active(core);
  core.state.discardPile.push(...core.state.cardStack.cards.splice(0));
  const before = cards(core).sort((a, b) => a - b);
  const top = core.state.discardPile.at(-1);
  const clone = core.clone();
  const result = core.apply(player.id, { type: 'draw' });
  assert.equal(result.accepted, true);
  assert.ok(result.events.some((event) => event.type === 'stack-refilled'));
  assert.deepEqual(core.state.discardPile, [top]);
  assert.deepEqual(cards(core).sort((a, b) => a - b), before);
  clone.apply(player.id, { type: 'draw' });
  assert.equal(clone.fingerprint(), core.fingerprint());
  const empty = fixture(); active(empty);
  empty.state.cardStack.cards = []; empty.state.discardPile = [];
  const fingerprint = empty.fingerprint();
  assert.deepEqual(empty.legalActions('p0'), []);
  assert.equal(empty.apply('p0', { type: 'draw' }).accepted, false);
  assert.equal(empty.apply('p0', { type: 'take-discard' }).accepted, false);
  assert.equal(empty.fingerprint(), fingerprint);
});

test('only exposed triples disappear; removing a column never retargets its old slot IDs', () => {
  const core = fixture(); const player = active(core, 'reveal card');
  setBoard(player, [[1,1,1], [2,2,2], [3,4,5], [6,6,6]],
    [[false,false,false], [true,true,false], [true,false,true], [false,false,false]]);
  const removed = [...player.slotIds[1]];
  const surviving = [...player.slotIds[2]];
  const before = cards(core).length;
  const result = core.apply(player.id, { type: 'reveal', slotId: removed[2] });
  assert.equal(result.accepted, true);
  assert.equal(cards(core).length, before);
  assert.deepEqual(player.deck, [[1,1,1], [3,4,5], [6,6,6]]);
  assert.deepEqual(player.slotIds[1], surviving);
  assert.ok(result.events.some((event) => event.type === 'column-removed'));
  active(core, 'place card'); player.cardCache = 5;
  const fingerprint = core.fingerprint();
  for (const slotId of removed) assert.equal(core.apply(player.id, { type: 'place', slotId }).accepted, false);
  assert.equal(core.fingerprint(), fingerprint);
  assert.equal(core.apply(player.id, { type: 'place', slotId: surviving[0] }).accepted, true);
  assert.equal(player.deck[1][0], 5);
});

test('each remaining player receives one final turn, across seat wraparound, before scoring', () => {
  const core = fixture({ playerCount: 4, pointLimit: 1_000 });
  core.state.players.forEach((player) => setBoard(player, [[0,1,2]], [[true,true,false]]));
  const closer = active(core, 'reveal card', 2);
  core.apply(closer.id, { type: 'reveal', slotId: closer.slotIds[0][2] });
  assert.equal(closer.closedRound, true);
  assert.equal(core.state.activePlayerId, 'p3');
  assert.ok(core.state.players.every((player) => player.totalPoints === 0));
  for (const id of ['p3', 'p0', 'p1']) {
    const player = core.state.players.find((candidate) => candidate.id === id);
    completeTurn(core, player);
  }
  assert.equal(core.state.phase, 'new round');
  assert.equal(core.state.activePlayerId, null);
  assert.deepEqual(core.state.players.map((player) => player.totalPoints), [3,3,6,3]);
  assert.ok(core.state.players.every((player) => player.knownCardPositions.flat().every(Boolean)));
  const oldSlots = core.state.players[0].slotIds.flat();
  const totals = core.state.players.map((player) => player.totalPoints);
  const fingerprint = core.fingerprint();
  assert.equal(core.apply('outsider', { type: 'next-round' }).accepted, false);
  assert.equal(core.fingerprint(), fingerprint);
  assert.equal(core.apply('p1', { type: 'next-round' }).accepted, true);
  assert.equal(core.state.round, 2);
  assert.deepEqual(core.state.players.map((player) => player.totalPoints), totals);
  assert.equal(core.apply('p1', { type: 'next-round' }).accepted, false);
  assert.equal(core.apply('p0', { type: 'reveal', slotId: oldSlots[0] }).accepted, false);
});

test('revealing all final cards removes hidden matching triples before score and penalty', () => {
  const core = fixture({ pointLimit: 1_000 });
  setBoard(core.state.players[0], [[0,1,2]], [[true,true,false]]);
  setBoard(core.state.players[1], [[12,12,12], [0,1,2]], [[false,false,false], [true,true,true]]);
  const closer = active(core, 'reveal card');
  core.apply(closer.id, { type: 'reveal', slotId: closer.slotIds[0][2] });
  const other = core.state.players[1];
  completeTurn(core, other);
  assert.equal(core.state.phase, 'new round');
  assert.deepEqual(other.deck, [[0,1,2]]);
  assert.equal(other.roundPoints, 3);
  assert.equal(closer.totalPoints, 6);
});

test('failed closer penalty doubles only positive scores; ties, zero and negatives follow the approved rule', () => {
  for (const [closerCards, otherCards, expected] of [
    [[0,1,2], [0,1,2], 6], // positive tie
    [[0,1,2], [-2,0,1], 6], // positive loss
    [[-1,0,1], [-2,0,1], 0], // zero loss
    [[-2,0,1], [-2,-1,0], -1], // negative loss
    [[-2,0,1], [-2,0,1], -1], // negative tie
    [[0,1,2], [1,2,3], 3], // uniquely lowest: no penalty
  ]) {
    const core = fixture({ pointLimit: 1_000 });
    setBoard(core.state.players[0], [closerCards], [[true,true,false]]);
    setBoard(core.state.players[1], [otherCards], [[true,true,false]]);
    const closer = active(core, 'reveal card');
    core.apply(closer.id, { type: 'reveal', slotId: closer.slotIds[0][2] });
    completeTurn(core, core.state.players[1]);
    assert.equal(closer.totalPoints, expected, `${closerCards} versus ${otherCards}`);
  }
});

test('point, round, action and abort limits are terminal and award tied placements', () => {
  for (const [options, reason] of [[{ pointLimit: 6 }, 'point-limit'], [{ maxRounds: 1 }, 'round-limit']]) {
    const core = fixture(options);
    core.state.players.forEach((player) => setBoard(player, [[0,1,2]], [[true,true,false]]));
    const closer = active(core, 'reveal card');
    core.apply(closer.id, { type: 'reveal', slotId: closer.slotIds[0][2] });
    completeTurn(core, core.state.players[1]);
    assert.equal(core.state.phase, 'game ended');
    assert.equal(core.state.endReason, reason);
    assert.deepEqual(core.state.players.map((player) => player.place), [2,1]);
    const fingerprint = core.fingerprint();
    assert.equal(core.apply('p0', { type: 'next-round' }).accepted, false);
    core.stop('aborted');
    assert.equal(core.fingerprint(), fingerprint);
  }
  const capped = fixture({ maxActions: 1 });
  capped.apply('p0', capped.legalActions('p0')[0]);
  assert.equal(capped.state.endReason, 'action-limit');
  assert.deepEqual(capped.state.players.map((player) => player.place), [1,1]);
  assert.deepEqual(capped.eligiblePlayerIds(), []);
  const aborted = fixture(); aborted.stop('aborted');
  assert.equal(aborted.state.endReason, 'aborted');
  assert.equal(aborted.state.revision, 1);
});

test('seeded headless games conserve cards every action, clone independently and replay exactly', () => {
  for (const count of [2,3,8]) {
    const core = fixture({ playerCount: count, seed: `full:${count}`, maxRounds: 3, pointLimit: 1_000 });
    const replay = fixture({ playerCount: count, seed: `full:${count}`, maxRounds: 3, pointLimit: 1_000 });
    const pack = cards(core).sort((a, b) => a - b);
    const random = createRandom(`actions:${count}`);
    let actions = 0;
    while (core.state.phase !== 'game ended' && actions++ < 10_000) {
      const id = core.eligiblePlayerIds()[0];
      assert.ok(id, `No eligible player at ${core.state.phase}`);
      const legal = core.legalActions(id);
      // Prefer progress: discard drawn card and reveal, while exercising placements too.
      let action;
      if (core.state.phase === 'pick up card') action = legal.find((candidate) => candidate.type === 'draw') ?? legal[0];
      else if (core.state.phase === 'place card') action = random() < 0.3
        ? legal[Math.floor(random() * legal.length)]
        : legal.find((candidate) => candidate.type === 'discard') ?? legal[0];
      else action = legal[Math.floor(random() * legal.length)];
      assert.equal(core.apply(id, action).accepted, true);
      assert.equal(replay.apply(id, action).accepted, true);
      assert.equal(cards(core).length, 150);
      assert.deepEqual(cards(core).sort((a, b) => a - b), pack);
      assert.equal(core.fingerprint(), replay.fingerprint());
      if (actions === 10) {
        const clone = core.clone();
        assert.equal(clone.fingerprint(), core.fingerprint());
        clone.stop('aborted');
        assert.notEqual(clone.fingerprint(), core.fingerprint());
        assert.notEqual(core.state.phase, 'game ended');
      }
    }
    assert.equal(core.state.endReason, 'round-limit');
    assert.ok(actions < 10_000);
  }
});
