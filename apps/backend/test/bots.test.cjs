const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createBot, validateBotConfig, registerBotStrategy, strategyInfo,
} = require('../src/game/bots/index.ts');

function player(id, deck, extra = {}) {
  return {
    id, name: id, kind: 'bot', deck,
    slotIds: deck.map((_, column) => [0, 1, 2].map((row) => `${id}:${column}:${row}`)),
    knownCardPositions: deck.map((column) => column.map((card) => card !== null)),
    playersTurn: id === 'a', cardCache: null, tookDispiledCard: false,
    roundPoints: deck.flat().reduce((sum, card) => sum + (card ?? 0), 0),
    totalPoints: 0, closedRound: false, place: null,
    ...extra,
  };
}

function observation(phase, deck, extra = {}) {
  return {
    protocolVersion: 2, ruleVersion: 'skylo-2-positive-penalty', matchId: 'test',
    sessionId: 'table', revision: 1, turn: 1, round: 1, phase, playerCount: 2,
    players: [player('a', deck), player('b', [[5, null, null], [8, null, null]])],
    activePlayerId: 'a', cardStack: { cards: Array(100).fill(null) },
    discardPile: [6], endReason: null, ownPlayerId: 'a', legalActions: [], ...extra,
  };
}

function placements(view, discard = true) {
  const own = view.players[0];
  return [
    ...own.slotIds.flat().map((slotId) => ({ type: 'place', slotId })),
    ...(discard ? [{ type: 'discard' }] : []),
  ];
}

function reveals(view) {
  return view.players[0].slotIds.flatMap((column, c) => column.filter((_, r) => !view.players[0].knownCardPositions[c][r])
    .map((slotId) => ({ type: 'reveal', slotId })));
}

function context(random = () => 0.5) {
  return { signal: new AbortController().signal, random, budget: { maxMs: 1000, maxIterations: 10000 } };
}

async function decide(view, actions, difficulty = 'hard', ctx = context()) {
  view.legalActions = actions;
  return createBot({ strategyId: 'rules', difficulty }).decide(view, actions, ctx);
}

test('configuration validation pins known strategy versions and rejects malformed/unknown configurations', () => {
  assert.deepEqual(validateBotConfig({ strategyId: 'rules', difficulty: 'medium' }), { strategyId: 'rules', version: '1', difficulty: 'medium' });
  assert.ok(strategyInfo().some(({ id, version }) => id === 'rules' && version === '1'));
  assert.ok(strategyInfo().some(({ id, version }) => id === 'random' && version === '1'));
  for (const config of [null, [], {}, 3, 'rules', { strategyId: 'rules', difficulty: 'impossible' },
    { strategyId: 'rules', difficulty: 'hard', version: '404' },
    { strategyId: '__proto__', difficulty: 'hard' },
    { strategyId: 'llm', difficulty: 'hard' },
    { strategyId: 'rules', difficulty: 'hard', cheat: true },
    { strategyId: 'rules', difficulty: 'hard', version: 1 },
  ]) assert.equal(validateBotConfig(config), null);
  assert.throws(() => createBot({ strategyId: 'missing', difficulty: 'easy' }), /configuration/);
});

test('custom asynchronous strategies have independent lifecycles and pinned versions', async () => {
  const logs = [];
  const unregister = registerBotStrategy({ id: 'test-model', version: '1', name: 'Test model', factory: (config) => {
    const events = [];
    logs.push(events);
    assert.ok(Object.isFrozen(config));
    return { id: 'test-model', version: '1',
      onStart: async () => events.push('start'),
      onEvent: async (event) => events.push(event.type),
      decide: async (_view, actions) => ({ action: actions[0] }),
      dispose: async () => events.push('dispose'),
    };
  } });
  try {
    assert.throws(() => registerBotStrategy('test-model', '1', () => ({})), /already registered/);
    const first = createBot({ strategyId: 'test-model', difficulty: 'hard' });
    const second = createBot({ strategyId: 'test-model', difficulty: 'easy' });
    assert.notEqual(first, second);
    await first.onStart({}); await first.onEvent({ type: 'round-ended' }); await first.dispose();
    assert.deepEqual(logs, [['start', 'round-ended', 'dispose'], []]);
    const unregister2 = registerBotStrategy('test-model', '2', () => ({ id: 'test-model', version: '2', decide: async (_, actions) => ({ action: actions[0] }) }));
    try {
      assert.equal(validateBotConfig({ strategyId: 'test-model', difficulty: 'hard' }).version, '2');
      assert.equal(createBot({ strategyId: 'test-model', version: '1', difficulty: 'hard' }).version, '1');
    } finally { unregister2(); }
  } finally { unregister(); unregister(); }
  assert.equal(validateBotConfig({ strategyId: 'test-model', difficulty: 'hard' }), null);
});

test('registry rejects invalid factories and registrations', () => {
  assert.throws(() => registerBotStrategy('bad id', '1', () => ({})), /registration/);
  assert.throws(() => registerBotStrategy({ id: 'bad-factory', version: '1', name: '', factory: null }), /registration/);
  const unregister = registerBotStrategy('wrong-result', '1', () => ({ id: 'other', version: '1', decide() {} }));
  try { assert.throws(() => createBot({ strategyId: 'wrong-result', difficulty: 'hard' }), /incompatible/); }
  finally { unregister(); }
});

test('all difficulties improve the highest open card with a low cached card', async () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const view = observation('place card', [[11, 4, null], [3, 0, null]]);
    view.players[0].cardCache = 2;
    const result = await decide(view, placements(view), difficulty);
    assert.deepEqual(result.action, { type: 'place', slotId: 'a:0:0' });
    assert.match(result.explanation, /11.*2/);
  }
});

test('a positive triple is valued by the total points removed, not just the replaced card', async () => {
  const view = observation('place card', [[7, 7, 12], [11, 3, null]]);
  view.players[0].cardCache = 7;
  const result = await decide(view, placements(view));
  assert.deepEqual(result.action, { type: 'place', slotId: 'a:0:2' });
  assert.match(result.explanation, /Dreierspalte/);
});

test('the bot preserves a negative pair instead of assembling a harmful negative triple', async () => {
  const view = observation('place card', [[-1, -1, -2], [9, 2, null]]);
  view.players[0].cardCache = -1;
  assert.deepEqual((await decide(view, placements(view))).action, { type: 'place', slotId: 'a:1:0' });
});

test('pickup compares the known discard with the expected value of a draw', async () => {
  const actions = [{ type: 'draw' }, { type: 'take-discard' }];
  const view = observation('pick up card', [[10, 4, null], [3, 0, null]], { discardPile: [0] });
  assert.equal((await decide(view, actions)).action.type, 'take-discard');
  view.discardPile = [12];
  assert.equal((await decide(view, actions)).action.type, 'draw');
  view.players[0] = player('a', [[7, 7, 12], [1, 2, null]]);
  view.discardPile = [7];
  assert.equal((await decide(view, actions)).action.type, 'take-discard');
});

test('a poor drawn card is discarded; a discard-picked card still must be placed', async () => {
  const view = observation('place card', [[-2, 1, null], [0, 2, null]]);
  view.players[0].cardCache = 12;
  assert.equal((await decide(view, placements(view))).action.type, 'discard');
  view.players[0].tookDispiledCard = true;
  assert.equal((await decide(view, placements(view, false))).action.type, 'place');
});

test('a fully revealed player can discard a poor card during the final turn', async () => {
  const view = observation('place card', [[-2, 1, 3], [0, 2, 4]]);
  view.players[0].cardCache = 12;
  view.players[1].closedRound = true;
  assert.equal((await decide(view, placements(view))).action.type, 'discard');
});

test('revealing favors a positive pair and avoids removing a negative pair', async () => {
  const positive = observation('reveal card', [[8, 8, null], [1, 2, null]]);
  assert.deepEqual((await decide(positive, reveals(positive))).action, { type: 'reveal', slotId: 'a:0:2' });
  const negative = observation('reveal card', [[-2, -2, null], [1, 2, null]]);
  assert.deepEqual((await decide(negative, reveals(negative))).action, { type: 'reveal', slotId: 'a:1:2' });
});

test('hard avoids prematurely closing a positive losing round', async () => {
  const view = observation('place card', [[10, 10, null]]);
  view.players[0].cardCache = 0;
  view.players[1] = player('b', [[-2, -1, null]]);
  assert.deepEqual((await decide(view, placements(view))).action, { type: 'place', slotId: 'a:0:1' });
});

test('a hard bot eventually favors progress after repeated turns with no board improvement', async () => {
  const bot = createBot({ strategyId: 'rules', difficulty: 'hard' });
  const view = observation('pick up card', [[10, 10, null]]);
  view.players[1] = player('b', [[-2, -1, null]]);
  for (let turn = 1; turn <= 30; turn++) {
    view.phase = 'pick up card'; view.turn = turn; view.players[0].cardCache = null;
    await bot.decide(view, [{ type: 'draw' }], context());
    view.phase = 'place card'; view.players[0].cardCache = 9;
    const actions = placements(view, false);
    const result = await bot.decide(view, actions, context());
    if (turn === 1) assert.notEqual(result.action.slotId, 'a:0:2');
    if (turn === 30) assert.equal(result.action.slotId, 'a:0:2');
  }
});

test('zero and negative final points incur no closing penalty', async () => {
  const view = observation('place card', [[-2, -1, null]]);
  view.players[0].cardCache = -2;
  view.players[1] = player('b', [[-2, -2, null]]);
  assert.deepEqual((await decide(view, placements(view))).action, { type: 'place', slotId: 'a:0:2' });
});

test('unknown card values are ignored and observations remain unchanged', async () => {
  const view = observation('place card', [[9, 0, null], [2, 4, null]]);
  view.players[0].cardCache = 1;
  const actions = placements(view);
  view.legalActions = actions;
  const before = JSON.stringify(view);
  const expected = (await decide(view, actions)).action;
  assert.equal(JSON.stringify(view), before);
  view.players[0].deck[0][2] = -2;
  view.players[0].deck[1][2] = 12;
  view.players[1].deck[0][1] = -2;
  assert.deepEqual((await decide(view, actions)).action, expected);
});

test('each strategy returns only a supplied legal action across phases and tiny budgets', async () => {
  for (const strategyId of ['rules', 'random']) for (const difficulty of ['easy', 'medium', 'hard']) {
    const bot = createBot({ strategyId, difficulty });
    for (const phase of ['reveal two cards', 'pick up card', 'place card', 'reveal card', 'new round']) {
      const view = observation(phase, [[null, null, null], [4, 2, null]]);
      view.players[0].cardCache = phase === 'place card' ? 3 : null;
      const actions = phase === 'pick up card' ? [{ type: 'draw' }, { type: 'take-discard' }]
        : phase === 'place card' ? placements(view)
        : phase === 'new round' ? [{ type: 'next-round' }] : reveals(view);
      for (const maxIterations of [0, 1, 10000]) {
        const ctx = context(); ctx.budget.maxIterations = maxIterations;
        const result = await bot.decide(view, actions, ctx);
        assert.ok(actions.includes(result.action));
      }
    }
    await assert.rejects(bot.decide(observation('game ended', [[0, 0, 0]]), [], context()), /No legal/);
  }
});

test('strategies honor aborted signals and disposed instances', async () => {
  for (const strategyId of ['rules', 'random']) {
    const bot = createBot({ strategyId, difficulty: 'medium' });
    const view = observation('pick up card', [[1, null, null]]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(bot.decide(view, [{ type: 'draw' }], { ...context(), signal: controller.signal }), { name: 'AbortError' });
    bot.dispose(); bot.dispose();
    await assert.rejects(bot.decide(view, [{ type: 'draw' }], context()), { name: 'AbortError' });
  }
});

test('supplied seeded randomness yields reproducible choices without using Math.random', async () => {
  function seeded(seed) {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  }
  const view = observation('reveal two cards', [[null, null, null], [null, null, null]]);
  const actions = reveals(view);
  for (const strategyId of ['rules', 'random']) {
    const sequences = [];
    for (let run = 0; run < 2; run++) {
      const ctx = context(seeded(42)); const bot = createBot({ strategyId, difficulty: 'easy' });
      const sequence = [];
      for (let i = 0; i < 20; i++) sequence.push((await bot.decide(view, actions, ctx)).action);
      sequences.push(sequence);
    }
    assert.deepEqual(sequences[0], sequences[1]);
  }
});

test('eight hard bots finish a seeded game that previously cycled without revealing their last cards', async () => {
  const { GameCore, createRandom } = require('../src/game/core/index.ts');
  const config = {
    matchId: 'simulation', sessionId: 'table', seed: 'bots-8-hard', maxActions: 2000,
    players: Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`, name: `Bot ${index}`, kind: 'bot',
      botConfig: { strategyId: 'rules', difficulty: 'hard' },
    })),
  };
  const core = new GameCore(config);
  const bots = config.players.map(({ botConfig }) => createBot(botConfig));
  while (core.state.phase !== 'game ended') {
    const id = core.eligiblePlayerIds()[0];
    assert.ok(id, `No eligible player during ${core.state.phase}`);
    const legalActions = core.legalActions(id);
    const view = { ...core.view(), ownPlayerId: id, legalActions };
    const result = await bots[Number(id.slice(1))].decide(view, legalActions, context(createRandom(`${config.seed}:${core.state.revision}`)));
    assert.equal(core.apply(id, result.action).accepted, true);
  }
  assert.equal(core.state.endReason, 'point-limit');
  assert.ok(core.state.actionCount < 2000);
  for (const bot of bots) bot.dispose();
});
