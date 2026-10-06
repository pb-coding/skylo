/* Run in the production image: no training, Python, source checkout or Git required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { GameCore } = require('../dist/game/core/GameCore');
const { createRandom } = require('../dist/game/core/random');
const { RuleBot } = require('../dist/game/bots/rules');
const { MLBot, readModelManifest } = require('../dist/game/ml/MLBot');
const { configureML } = require('../dist/game/ml/configureML');
const { GameRunner } = require('../dist/game/runtime/GameRunner');
const { verifyRecord } = require('../dist/game/recording/verifyRecord');
const { RULE_VERSION } = require('../dist/protocol/gameProtocol');
const manifestPath = process.argv[2] || process.env.SKYLO_ML_MANIFEST;
const games = Number(process.argv[3] || 20);
assert.ok(manifestPath && Number.isInteger(games) && games >= 2 && games <= 100 && games % 2 === 0,
  'Usage: node scripts/ml-runtime-smoke.cjs <manifest> [even games: 2..100]');
const manifest = readModelManifest(manifestPath);
const results = [], latencies = [];

async function match(index) {
  const seed = `hetzner-runtime-smoke-v1:${Math.floor(index / 2)}`, seat = index % 2;
  const core = new GameCore({ matchId: `smoke-${index}`, sessionId: 'smoke', seed,
    players: [0, 1].map(i => ({ id: `p${i}`, name: `Seat ${i}`, kind: 'bot' })),
    pointLimit: 100, maxRounds: 100, maxActions: 100000 });
  const bots = [0, 1].map(i => i === seat ? new MLBot(manifest.modelPath, manifest.version) : new RuleBot('hard'));
  try {
    while (core.state.phase !== 'game ended') {
      if (core.state.phase === 'new round') { assert.ok(core.apply('p0', { type: 'next-round' }).accepted); continue; }
      const id = core.eligiblePlayerIds()[0], active = id === 'p0' ? 0 : 1;
      const view = { ...core.view(), ownPlayerId: id, legalActions: core.legalActions(id) };
      const before = performance.now();
      const decision = await bots[active].decide(view, view.legalActions, {
        signal: new AbortController().signal, random: createRandom(`${seed}:bot:seat${active}:${core.state.revision}`),
        budget: { maxMs: 1000, maxIterations: 1000 },
        publicRules: { ruleVersion: RULE_VERSION, pointLimit: 100, maxRounds: 100, maxActions: 100000 },
      });
      if (active === seat && view.legalActions.length > 1) {
        latencies.push(performance.now() - before);
        assert.equal(decision.diagnostics?.source, 'model');
      }
      assert.ok(core.apply(id, decision.action).accepted, 'Model action must be legal');
    }
    assert.equal(core.state.endReason, 'point-limit');
    return { index, seed, seat, scores: core.state.players.map(player => player.totalPoints),
      actions: core.state.actionCount, fingerprint: core.fingerprint() };
  } finally { bots.forEach(bot => bot.dispose()); }
}

async function runnerSmoke() {
  const unregister = configureML({ SKYLO_ML_MANIFEST: manifestPath });
  try {
    await new Promise((resolve, reject) => {
      let runner;
      const timeout = setTimeout(() => { runner?.stop('aborted'); reject(Error('Runner timeout')); }, 15000);
      runner = new GameRunner({ matchId: 'runtime-runner', sessionId: 'smoke', seed: 'runtime-runner', maxActions: 30,
        players: [{ id: 'p0', name: 'Model', kind: 'bot', botConfig: { strategyId: 'ml', version: manifest.version, profile: 'trained' } },
          { id: 'p1', name: 'Hard', kind: 'bot', botConfig: { strategyId: 'rules', difficulty: 'hard' } }] },
      { delayMs: 0, onEnd: () => {
        clearTimeout(timeout);
        try {
          const record = runner.exportRecord();
          assert.ok(record.actions.some(action => action.diagnostics?.source === 'model'));
          assert.ok(record.actions.every(action => !action.fallback), 'No fallback decisions');
          assert.ok(verifyRecord(record));
          resolve();
        } catch (error) { reject(error); }
      } });
      runner.start();
    });
  } finally { unregister(); }
}

(async () => {
  for (let i = 0; i < games; i++) results.push(await match(i));
  await runnerSmoke();
  latencies.sort((a, b) => a - b);
  const report = { model: manifest.version, modelSha256: manifest.sha256, platform: process.platform,
    arch: process.arch, node: process.version, games, runner: 'PASS: replay verified, zero fallback',
    latencyMs: { median: latencies[Math.floor(latencies.length * .5)], p95: latencies[Math.floor(latencies.length * .95)], max: latencies.at(-1) }, results };
  if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });
