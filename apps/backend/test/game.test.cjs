const assert = require('node:assert/strict');
const { test } = require('node:test');
const { GameRunner } = require('../src/game/runtime/GameRunner');
const { verifyRecord } = require('../src/game/recording');

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

/** Advance scheduled work explicitly, without wall-clock timing assertions. */
class Clock {
  time = 0;
  sequence = 0;
  timers = new Map();
  now = () => this.time;
  setTimeout = (callback, delay) => {
    const id = ++this.sequence;
    this.timers.set(id, { due: this.time + Math.max(0, delay), callback });
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  async advance(milliseconds) {
    const target = this.time + milliseconds;
    await flush();
    for (let count = 0; count < 10_000; count++) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > target) {
        this.time = target;
        await flush();
        return;
      }
      this.time = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    assert.fail('Scheduled work did not settle after 10,000 callbacks');
  }
  async until(predicate, limit = 10_000) {
    for (let count = 0; count < limit; count++) {
      await flush();
      if (predicate()) return;
      const next = [...this.timers.values()].sort((a, b) => a.due - b.due)[0];
      assert.ok(next, 'Runner stopped scheduling before its terminal state');
      await this.advance(Math.max(0, next.due - this.time));
    }
    assert.fail('Runner did not complete within the scheduled-work limit');
  }
}

const players = kind => ['a', 'b'].map(id => ({
  id, name: id.toUpperCase(), kind,
  ...(kind === 'bot' ? { botConfig: { strategyId: 'rules', difficulty: 'medium' } } : {}),
}));
const config = (kind = 'human', overrides = {}) => ({
  matchId: 'match', sessionId: 'table', seed: 'regression-seed', players: players(kind), ...overrides,
});
const actionRequest = (view, action = view.legalActions[0], requestId = `request-${view.revision}`) => ({
  sessionId: view.sessionId, matchId: view.matchId, decisionId: view.decisionId, requestId, action,
});
const firstActionStrategy = overrides => ({
  id: 'test', version: '1', decide: async (_, legalActions) => ({ action: legalActions[0] }), ...overrides,
});

test('runner views redact board backs, stack and seeds, and give spectators no action token', () => {
  const runner = new GameRunner(config());
  try {
    runner.start();
    const human = runner.view('a', 'player');
    const viewer = runner.view(null, 'spectator');
    assert.equal(human.ownPlayerId, 'a');
    assert.equal(human.legalActions.length, 12);
    assert.equal(typeof human.decisionId, 'string');
    assert.equal(viewer.ownPlayerId, null);
    assert.equal(viewer.decisionId, null);
    assert.deepEqual(viewer.legalActions, []);
    assert.ok(viewer.cardStack.cards.every(card => card === null));
    assert.ok(viewer.players.every(player => player.deck.flat().every(card => card === null)));
    assert.equal('seed' in human, false);
    assert.equal('seed' in viewer, false);
    assert.equal(runner.exportRecord(), null);
    human.players[0].totalPoints = 900;
    human.players[0].slotIds[0][0] = 'wrong-slot';
    assert.equal(runner.core.state.players[0].totalPoints, 0);
    assert.notEqual(runner.core.state.players[0].slotIds[0][0], 'wrong-slot');
  } finally { runner.stop(); }
});

test('malformed, outsider and wrong-match requests leave the complete state unchanged', () => {
  const runner = new GameRunner(config());
  try {
    runner.start();
    const view = runner.view('a', 'player');
    const valid = actionRequest(view);
    const fingerprint = runner.core.fingerprint();
    for (const payload of [null, {}, [], 'reveal', { ...valid, action: null },
      { ...valid, action: { type: 'reveal', slotId: 'missing' } },
      { ...valid, requestId: '' }, { ...valid, decisionId: null }]) {
      assert.notEqual(runner.submit('a', payload), 'success');
      assert.equal(runner.core.fingerprint(), fingerprint);
    }
    assert.notEqual(runner.submit('outsider', valid), 'success');
    assert.notEqual(runner.submit('a', { ...valid, matchId: 'old-match' }), 'success');
    assert.notEqual(runner.submit('a', { ...valid, sessionId: 'other-table' }), 'success');
    assert.equal(runner.core.fingerprint(), fingerprint);
  } finally { runner.stop(); }
});

test('a repeated request is idempotent and a stale decision cannot apply to a new state', () => {
  const runner = new GameRunner(config());
  try {
    runner.start();
    const first = runner.view('a', 'player');
    const request = actionRequest(first, first.legalActions[0], 'unique-request');
    assert.equal(runner.submit('a', request), 'success');
    const fingerprint = runner.core.fingerprint();
    assert.equal(runner.submit('a', request), 'success');
    assert.equal(runner.core.fingerprint(), fingerprint);
    assert.equal(runner.submit('a', { ...request, requestId: 'late-request', action: first.legalActions[1] }), 'error:stale');
    assert.notEqual(runner.submit('a', { ...request, action: first.legalActions[1] }), 'success');
    assert.equal(runner.core.fingerprint(), fingerprint);
    const fresh = runner.view('a', 'player');
    assert.notEqual(fresh.decisionId, first.decisionId);
    assert.equal(runner.submit('a', actionRequest(fresh)), 'success');
    assert.equal(runner.view('a', 'player').decisionId, null);
  } finally { runner.stop(); }
});

test('pause and artificial delays do not hold up human inputs', () => {
  const clock = new Clock();
  const runner = new GameRunner(config(), { clock, delayMs: 60_000 });
  try {
    runner.start();
    assert.equal(runner.control({ type: 'pause' }), 'success');
    const view = runner.view('a', 'player');
    assert.equal(runner.submit('a', actionRequest(view)), 'success');
    assert.equal(runner.core.state.revision, 1);
    assert.equal(clock.time, 0);
    assert.equal(runner.view('a', 'player').playback.paused, true);
  } finally { runner.stop(); }
  assert.equal(clock.timers.size, 0);
});

test('changing speed adjusts a pending bot action and never repeats its decision', async () => {
  const clock = new Clock();
  let calls = 0;
  const runner = new GameRunner(config('bot', { maxActions: 1 }), {
    clock, delayMs: 1_000,
    strategyFactory: () => firstActionStrategy({ decide: async (_, actions) => {
      calls++;
      return { action: actions[0] };
    } }),
  });
  try {
    runner.start();
    await clock.advance(400);
    assert.equal(runner.core.state.revision, 0);
    assert.equal(calls, 1);
    assert.equal(runner.control({ type: 'delay', delayMs: 100 }), 'success');
    await clock.advance(0);
    assert.equal(runner.core.state.actionCount, 1);
    assert.equal(calls, 1);
    assert.equal(runner.core.state.phase, 'game ended');
  } finally { runner.stop(); }
  assert.equal(clock.timers.size, 0);
});

test('pause retains a computed decision, and action stepping advances exactly one action', async () => {
  const clock = new Clock();
  let resolveDecision;
  let published;
  const runner = new GameRunner(config('bot'), {
    clock, delayMs: 500, onUpdate: game => { published = game.view(null, 'spectator'); },
    strategyFactory: () => firstActionStrategy({ decide: (_, actions) => new Promise(resolve => {
      resolveDecision = () => resolve({ action: actions[0] });
    }) }),
  });
  try {
    runner.start();
    await flush();
    assert.equal(runner.control({ type: 'pause' }), 'success');
    resolveDecision();
    await clock.advance(2_000);
    assert.equal(runner.core.state.revision, 0);
    assert.equal(published.playback.thinking, false);
    assert.equal(runner.control({ type: 'step-action' }), 'success');
    await clock.advance(0);
    assert.equal(runner.core.state.actionCount, 1);
    assert.equal(runner.view(null, 'spectator').playback.paused, true);
    await clock.advance(100);
    assert.equal(runner.core.state.actionCount, 1);
  } finally { runner.stop(); }
  assert.equal(clock.timers.size, 0);
});

test('async strategy initialization finishes before a replacement decision is requested', async () => {
  const clock = new Clock();
  let releaseStart;
  let starts = 0;
  let decisions = 0;
  const specs = players('human');
  specs[1] = { ...specs[1], kind: 'bot', botConfig: { strategyId: 'rules', difficulty: 'medium' } };
  const runner = new GameRunner(config('human', { players: specs, maxActions: 2 }), {
    clock, delayMs: 0,
    strategyFactory: () => firstActionStrategy({
      onStart: () => { starts++; return new Promise(resolve => { releaseStart = resolve; }); },
      decide: async (_, actions) => { decisions++; return { action: actions[0] }; },
    }),
  });
  try {
    runner.start();
    await flush();
    assert.equal(starts, 1);
    assert.equal(decisions, 0);
    assert.equal(runner.submit('a', actionRequest(runner.view('a', 'player'))), 'success');
    await flush();
    assert.equal(starts, 1);
    assert.equal(decisions, 0, 'Replacement decision must await shared initialization');
    releaseStart();
    await clock.advance(0);
    assert.equal(decisions, 1, 'Cancelled initialization must not launch a stale decision');
    assert.equal(runner.core.state.actionCount, 2);
  } finally { runner.stop(); await flush(); }
  assert.equal(clock.timers.size, 0);
});

test('turn stepping stops at player change and automatic execution resumes on request', async () => {
  const clock = new Clock();
  const runner = new GameRunner(config('bot'), {
    clock, delayMs: 100, strategyFactory: () => firstActionStrategy(),
  });
  try {
    runner.start();
    await clock.until(() => runner.core.state.phase === 'pick up card');
    assert.equal(runner.control({ type: 'pause' }), 'success');
    const oldTurn = runner.core.state.turn;
    const oldPlayer = runner.core.state.activePlayerId;
    const oldActions = runner.core.state.actionCount;
    assert.equal(runner.control({ type: 'step-turn' }), 'success');
    await clock.until(() => runner.core.state.turn !== oldTurn);
    assert.equal(runner.core.state.actionCount, oldActions + 2);
    assert.notEqual(runner.core.state.activePlayerId, oldPlayer);
    assert.equal(runner.view(null, 'spectator').playback.paused, true);
    await clock.advance(1_000);
    assert.equal(runner.core.state.actionCount, oldActions + 2);
    assert.equal(runner.control({ type: 'resume' }), 'success');
    await clock.advance(100);
    assert.ok(runner.core.state.actionCount > oldActions + 2);
  } finally { runner.stop(); }
  assert.equal(clock.timers.size, 0);
});

test('invalid playback commands never change control state', () => {
  const runner = new GameRunner(config());
  try {
    runner.start();
    const playback = runner.view(null, 'spectator').playback;
    for (const command of [null, {}, [], { type: 'warp' }, { type: 'delay', delayMs: -1 },
      { type: 'delay', delayMs: Infinity }, { type: 'delay', delayMs: '100' }]) {
      assert.equal(runner.control(command), 'error:invalid');
      assert.deepEqual(runner.view(null, 'spectator').playback, playback);
    }
  } finally { runner.stop(); }
});

test('invalid bot outputs use an allowed fallback and record the strategy failure', async () => {
  const clock = new Clock();
  const runner = new GameRunner(config('bot', { maxActions: 1 }), {
    clock, delayMs: 0,
    strategyFactory: () => firstActionStrategy({ decide: async () => ({ action: { type: 'destroy' } }) }),
  });
  runner.start();
  await clock.until(() => runner.disposed);
  assert.equal(runner.core.state.actionCount, 1);
  const record = runner.exportRecord();
  assert.ok(record);
  assert.equal(record.actions[0].fallback, true);
  assert.equal(verifyRecord(record).valid, true);
  assert.equal(clock.timers.size, 0);
});

test('legal strategy actions are compared by fields rather than JSON key order', async () => {
  const clock = new Clock();
  const runner = new GameRunner(config('bot', { maxActions: 1 }), {
    clock, delayMs: 0,
    strategyFactory: () => firstActionStrategy({ decide: async (_, actions) => ({
      action: { slotId: actions[0].slotId, type: actions[0].type },
    }) }),
  });
  runner.start();
  await clock.until(() => runner.disposed);
  assert.equal(runner.exportRecord().actions[0].fallback, false);
  assert.equal(clock.timers.size, 0);
});

test('strategy adapters receive immutable public observations and one lifecycle per instance', async () => {
  const clock = new Clock();
  const observations = [];
  const starts = [];
  const disposals = [];
  const runner = new GameRunner(config('bot', { maxActions: 8 }), {
    clock, delayMs: 0,
    strategyFactory: () => {
      const instance = Symbol('strategy');
      return firstActionStrategy({
        onStart: () => { starts.push(instance); },
        decide: async (observation, actions) => {
          observations.push(observation);
          return { action: actions[0] };
        },
        dispose: () => { disposals.push(instance); },
      });
    },
  });
  runner.start();
  await clock.until(() => runner.disposed);
  assert.equal(starts.length, 2);
  assert.equal(new Set(starts).size, 2);
  assert.deepEqual(new Set(disposals), new Set(starts));
  assert.equal(observations.length, 8);
  assert.ok(observations[0].players.every(player => player.deck.flat().every(card => card === null)));
  for (const observation of observations) {
    assert.equal('seed' in observation, false);
    assert.equal('state' in observation, false);
    assert.ok(observation.cardStack.cards.every(card => card === null));
    assert.ok(Object.isFrozen(observation));
    assert.ok(Object.isFrozen(observation.legalActions));
    assert.ok(Object.isFrozen(observation.players[0].deck[0]));
    assert.ok(observation.legalActions.length > 0);
  }
  assert.ok(runner.exportRecord().actions.every(action => !action.fallback));
  assert.equal(clock.timers.size, 0);
});

test('bot decision timeout aborts the request, uses a fallback and disposes the strategy', async () => {
  const clock = new Clock();
  const signals = [];
  let disposed = 0;
  const runner = new GameRunner(config('bot', { maxActions: 1 }), {
    clock, delayMs: 0, decisionTimeoutMs: 100,
    strategyFactory: () => firstActionStrategy({
      decide: (_, __, context) => { signals.push(context.signal); return new Promise(() => {}); },
      dispose: () => { disposed++; },
    }),
  });
  runner.start();
  await clock.advance(99);
  assert.equal(runner.core.state.actionCount, 0);
  await clock.advance(1);
  assert.equal(runner.disposed, true);
  assert.equal(runner.core.state.actionCount, 1);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(disposed, 2);
  assert.equal(runner.exportRecord().actions[0].fallback, true);
  assert.equal(clock.timers.size, 0);
});

test('stopping cancels pending decisions; late output cannot revive the match', async () => {
  const clock = new Clock();
  let release;
  let signal;
  let ended = 0;
  const runner = new GameRunner(config('bot'), {
    clock, delayMs: 100, onEnd: () => { ended++; },
    strategyFactory: () => firstActionStrategy({ decide: (_, actions, context) => {
      signal = context.signal;
      return new Promise(resolve => { release = () => resolve({ action: actions[0] }); });
    } }),
  });
  runner.start();
  await flush();
  runner.stop();
  runner.stop();
  const fingerprint = runner.core.fingerprint();
  assert.equal(signal.aborted, true);
  assert.equal(clock.timers.size, 0, 'Stop clears the timeout synchronously');
  release();
  await clock.advance(10_000);
  assert.equal(runner.core.fingerprint(), fingerprint);
  assert.equal(runner.core.state.actionCount, 0);
  assert.equal(runner.disposed, true);
  assert.equal(ended, 1);
  assert.equal(clock.timers.size, 0);
});

test('100 successive bot starts and stops retain no pending timers or live signals', async () => {
  for (let index = 0; index < 100; index++) {
    const clock = new Clock();
    const signals = [];
    const runner = new GameRunner(config('bot'), {
      clock,
      strategyFactory: () => firstActionStrategy({ decide: (_, __, context) => {
        signals.push(context.signal);
        return new Promise(() => {});
      } }),
    });
    runner.start();
    await flush();
    runner.stop();
    runner.stop();
    assert.equal(clock.timers.size, 0, 'No decision deadline survives stop');
    await flush();
    assert.equal(clock.timers.size, 0);
    assert.ok(signals.every(signal => signal.aborted));
  }
});

test('real rule bots finish matches; speed preserves actions and exported replay', async () => {
  async function play(delayMs) {
    const clock = new Clock();
    const runner = new GameRunner(config('bot', { maxRounds: 1 }), { clock, delayMs });
    runner.start();
    await clock.until(() => runner.disposed);
    assert.equal(runner.core.state.phase, 'game ended');
    assert.equal(runner.core.state.endReason, 'round-limit');
    assert.equal(clock.timers.size, 0);
    const record = runner.exportRecord();
    assert.ok(record);
    const replay = verifyRecord(record);
    assert.equal(replay.valid, true, replay.error);
    assert.ok(record.actions.length > 4);
    assert.equal(record.config.seed, 'regression-seed');
    assert.equal(record.completion.scores.length, 2);
    return record;
  }
  const fast = await play(0);
  const slow = await play(500);
  assert.deepEqual(fast.actions.map(({ playerId, action, fingerprint }) => ({ playerId, action, fingerprint })),
    slow.actions.map(({ playerId, action, fingerprint }) => ({ playerId, action, fingerprint })));
  assert.equal(fast.completion.fingerprint, slow.completion.fingerprint);
});

test('speed changes adjust elapsed waiting before an automatic next round', async () => {
  const clock = new Clock();
  const runner = new GameRunner(config('bot', { maxRounds: 2, pointLimit: 1_000_000 }), { clock, delayMs: 1_000 });
  try {
    runner.start();
    await clock.until(() => runner.core.state.phase === 'new round');
    assert.equal(runner.core.state.round, 1);
    await clock.advance(400);
    assert.equal(runner.core.state.round, 1);
    assert.equal(runner.control({ type: 'delay', delayMs: 100 }), 'success');
    await clock.advance(0);
    assert.equal(runner.core.state.round, 2);
    assert.equal(runner.core.state.phase, 'reveal two cards');
  } finally { runner.stop(); await flush(); }
  assert.equal(clock.timers.size, 0);
});

test('seeded bot decisions reproduce across newly allocated player identities', async () => {
  async function play(ids) {
    const clock = new Clock();
    const specs = players('bot').map((player, seat) => ({ ...player, id: ids[seat], botConfig: {
      strategyId: seat === 0 ? 'rules' : 'random', difficulty: 'easy',
    } }));
    const runner = new GameRunner(config('bot', { players: specs, maxRounds: 1 }), { clock, delayMs: 0 });
    runner.start();
    await clock.until(() => runner.disposed);
    const record = runner.exportRecord();
    assert.equal(verifyRecord(record).valid, true);
    return {
      actions: record.actions.map(({ playerId, action }) => ({ seat: ids.indexOf(playerId), action })),
      scores: record.completion.scores.map(({ playerId, ...score }) => ({ seat: ids.indexOf(playerId), ...score })),
    };
  }
  const first = await play(['initial-player-a', 'initial-player-b']);
  const next = await play(['new-player-a', 'new-player-b']);
  assert.deepEqual(next, first);
});
