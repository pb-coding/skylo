const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { GameCore } = require('../src/game/core/GameCore');
const { MatchRecorder, verifyRecord } = require('../src/game/recording');

const configuration = (overrides = {}) => ({
  matchId: 'recording-match', sessionId: 'recording-session', seed: 'reproducible-recording', maxRounds: 1,
  players: [{ id: 'a', name: 'Alice', kind: 'human' }, { id: 'b', name: 'Bob', kind: 'human' }], ...overrides,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function next(core, recorder) {
  const playerId = core.eligiblePlayerIds()[0];
  assert.ok(playerId, 'Every live state must have an eligible player');
  const legal = core.legalActions(playerId);
  // Discarding and revealing eventually closes the round, while exercising every move phase.
  const action = legal.find((item) => item.type === 'discard') || legal.find((item) => item.type === 'draw') || legal[0];
  const result = core.apply(playerId, action);
  assert.equal(result.accepted, true);
  const state = core.view();
  recorder.recordAction({ playerId, action, revision: state.revision, round: state.round, turn: state.turn,
    decisionMs: 2.5, events: result.events, fingerprint: core.fingerprint(), explanation: 'Test decision' });
}

function recordedGame(config = configuration()) {
  const core = new GameCore(config);
  const recorder = new MatchRecorder(config, core.fingerprint());
  for (let count = 0; core.view().phase !== 'game ended' && count < 1_000; count++) next(core, recorder);
  assert.equal(core.view().phase, 'game ended');
  recorder.finish(core);
  return { core, recorder, record: recorder.export() };
}

test('completed recordings reproduce every accepted action, events, hidden state and final scores', () => {
  const { core, record } = recordedGame();
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.config.seed, 'reproducible-recording');
  assert.equal(record.completion.endReason, core.view().endReason);
  assert.ok(record.actions.length > 10);
  assert.deepEqual(verifyRecord(clone(record)), { valid: true, actions: record.actions.length });
});

test('replay depends on recorded actions rather than installed bot implementations or JSON key order', () => {
  const config = configuration({ players: [
    { id: 'a', name: 'Future LLM', kind: 'bot', botConfig: { strategyId: 'future-llm', difficulty: 'hard', version: '2030.1' } },
    { id: 'b', name: 'Future RL', kind: 'bot', botConfig: { strategyId: 'future-rl', difficulty: 'hard', version: 'model-v12' } },
  ] });
  const { record } = recordedGame(config);
  assert.equal(record.config.players[0].botConfig.version, '2030.1');
  const reorder = (value) => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reorder(value[key])]));
    return value;
  };
  assert.deepEqual(verifyRecord(reorder(record)), { valid: true, actions: record.actions.length });
});

test('seeds and logs cannot be exported until completion; returned data cannot mutate retained records', () => {
  const config = configuration();
  const core = new GameCore(config);
  const recorder = new MatchRecorder(config);
  next(core, recorder);
  recorder.recordControl({ type: 'delay', delayMs: 750 });
  assert.equal(recorder.export(), null);
  assert.throws(() => recorder.finish(core), /completed/);
  core.stop('aborted'); recorder.finish(core);
  const record = recorder.export();
  assert.deepEqual(record.controls[0].command, { type: 'delay', delayMs: 750 });
  assert.equal(record.controls[0].afterAction, 1);
  record.config.seed = 'changed';
  record.actions[0].action.slotId = 'changed';
  assert.equal(recorder.export().config.seed, config.seed);
  assert.notEqual(recorder.export().actions[0].action.slotId, 'changed');
  assert.deepEqual(verifyRecord(recorder.export()), { valid: true, actions: 1 });
  assert.throws(() => next(core, recorder));
  assert.throws(() => recorder.recordControl({ type: 'resume' }), /completed/);
});

test('aborted games replay the explicit final stop rather than inventing a natural ending', () => {
  const config = configuration();
  const core = new GameCore(config);
  const recorder = new MatchRecorder(config);
  for (let index = 0; index < 7; index++) next(core, recorder);
  core.stop('aborted'); recorder.finish(core);
  const record = recorder.export();
  assert.equal(record.completion.endReason, 'aborted');
  assert.deepEqual(verifyRecord(record), { valid: true, actions: 7 });
  const fakeEnding = clone(record);
  fakeEnding.completion.endReason = 'round-limit';
  assert.equal(verifyRecord(fakeEnding).valid, false);
});

test('expired logs stay unavailable while the final game and previously downloaded recording remain valid', () => {
  const config = configuration();
  const active = new MatchRecorder(config);
  assert.equal(active.available, false);
  assert.throws(() => active.expire(), /active/);
  const { core, recorder, record } = recordedGame(config);
  const finalGame = clone(core.view());
  assert.equal(recorder.available, true);
  recorder.expire();
  assert.equal(recorder.available, false);
  assert.equal(recorder.export(), null);
  assert.deepEqual(core.view(), finalGame);
  assert.deepEqual(verifyRecord(record), { valid: true, actions: record.actions.length });
  // Retrying lifecycle operations must not make expired seeds or logs available again.
  recorder.finish(core);
  recorder.expire();
  assert.equal(recorder.available, false);
  assert.equal(recorder.export(), null);
});

test('action limits terminate the game with every accepted action retained', () => {
  const { recorder, record } = recordedGame(configuration({ maxActions: 6 }));
  assert.equal(record.completion.endReason, 'action-limit');
  assert.equal(record.actions.length, 6);
  assert.deepEqual(verifyRecord(record), { valid: true, actions: 6 });
  assert.throws(() => new MatchRecorder(configuration({ maxActions: 100_001 })), /limit/);
  assert.throws(() => new MatchRecorder(configuration({ maxActions: 0 })), /limit/);
  const active = new MatchRecorder(configuration({ maxActions: 1 }));
  active.recordAction(record.actions[0]);
  assert.throws(() => active.recordAction(record.actions[1]), /limit/);
  assert.throws(() => recorder.recordAction(record.actions[0]), /completed/);
});

test('replay detects changed actions, state counters, event payloads, hashes and scores', () => {
  const { record } = recordedGame();
  const mutations = [
    (copy) => { copy.actions[0].action = { type: 'draw' }; },
    (copy) => { copy.actions[0].revision += 1; },
    (copy) => { copy.actions[0].fingerprint = '0'.repeat(64); },
    (copy) => { copy.actions[0].events[0].type = 'invented-event'; },
    (copy) => { copy.completion.fingerprint = '0'.repeat(64); },
    (copy) => { copy.completion.scores[0].totalPoints += 1; },
    (copy) => { copy.config.seed = 'another-deck'; },
    (copy) => { copy.actions.pop(); },
  ];
  for (const mutate of mutations) {
    const changed = clone(record); mutate(changed);
    assert.equal(verifyRecord(changed).valid, false);
  }
});

test('replay rejects unknown versions and malformed or oversized records before applying actions', () => {
  const { record } = recordedGame();
  const invalid = [null, [], {}, { ...record, schemaVersion: 99 }, { ...record, ruleVersion: 'future-rules' },
    { ...record, actions: Array(100_001).fill(record.actions[0]) },
    { ...record, config: { ...record.config, players: [] } },
    { ...record, completion: { ...record.completion, scores: [{ playerId: 'a', roundPoints: Infinity }] } }];
  for (const value of invalid) {
    const result = verifyRecord(value);
    assert.equal(result.valid, false);
    assert.equal(result.actions, 0);
  }
});

test('replay CLI reads a downloaded JSON recording and reports verification', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skylo-replay-'));
  try {
    const filename = path.join(directory, 'match.json');
    const { record } = recordedGame();
    fs.writeFileSync(filename, JSON.stringify(record));
    const script = path.resolve(__dirname, '../scripts/replay.cjs');
    const output = [];
    const cliProcess = { argv: [process.execPath, script, filename] };
    vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
      require: createRequire(script), process: cliProcess,
      console: { log: (message) => output.push(message), error: (message) => output.push(message) },
    }, { filename: script });
    assert.equal(cliProcess.exitCode, undefined);
    assert.match(output.join('\n'), /Replay verified/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
