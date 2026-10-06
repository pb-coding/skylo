const test = require('node:test');
const assert = require('node:assert/strict');
const { GameCore } = require('../src/game/core/GameCore');
const { encodeObservation, decodeAction, actionIndex, PublicMemory, OBSERVATION_SIZE } = require('../src/game/ml/observation');

function observation() {
  const core = new GameCore({ matchId: 'test', sessionId: 'test', seed: 'fairness', players: [0,1].map(i=>({id:`p${i}`,name:'Private name',kind:'bot'})) });
  return { ...core.view(), ownPlayerId:'p0', legalActions:core.legalActions('p0') };
}
test('training teacher parameters cannot mutate the reference hard opponent',()=>{
  const {trainingTeacher}=require('../src/game/ml/simulator');
  const {RuleBot}=require('../src/game/bots/rules');
  const baseline=new RuleBot('hard');const weights={...baseline.weights};
  const student=trainingTeacher({pairs:2,endRisk:10,information:.4});
  assert.deepEqual(baseline.weights,weights);
  assert.deepEqual(new RuleBot('hard').weights,weights);
  assert.notEqual(student.weights,baseline.weights);
  assert.equal(student.weights.pairs,2);assert.equal(student.weights.endRisk,10);
  const patient=trainingTeacher({pairs:2},{closing:64,information:12});
  assert.notEqual(patient.closingPenalty,baseline.closingPenalty);
  assert.equal(new RuleBot('hard').closingPenalty,baseline.closingPenalty);
  assert.deepEqual(baseline.weights,weights);
  assert.throws(()=>trainingTeacher({noise:5}),/Invalid/);
  assert.throws(()=>trainingTeacher(undefined,{closing:0,information:12}),/Invalid/);
});
test('ML encoder ignores all hidden values, identities, seeds and private fingerprints', () => {
  const view=observation(), encoded=encodeObservation(view,view.legalActions);
  assert.equal(encoded.observation.length,OBSERVATION_SIZE);
  const changed=JSON.parse(JSON.stringify(view));
  for(const player of changed.players) { player.name='Different'; for(const column of player.deck) column.fill(12); }
  changed.matchId='Other';changed.sessionId='Other';changed.seed='injected';changed.fingerprint='private';
  assert.deepEqual(encodeObservation(changed,changed.legalActions),encoded);
  changed.players[0].id='self';changed.players[1].id='opponent';changed.ownPlayerId='self';
  assert.deepEqual(encodeObservation(changed,changed.legalActions),encoded);
});
test('ML action mapping preserves original column identities after column removal', () => {
  const view=observation();
  const action=view.legalActions.find(x=>x.slotId.includes(':c3:r2'));
  assert.equal(actionIndex(action),15);
  view.players[0].deck.splice(0,1);view.players[0].slotIds.splice(0,1);view.players[0].knownCardPositions.splice(0,1);
  const legal=view.legalActions.filter(x=>!x.slotId.includes(':c0:'));
  const encoded=encodeObservation(view,legal);
  assert.equal(encoded.mask[4],0);assert.equal(encoded.mask[15],1);
  assert.deepEqual(decodeAction(15,legal),action);
  assert.throws(()=>decodeAction(4,legal),/Illegal/);
});
test('ML unknown zero and removed slots are encoded as different states', () => {
  const view=observation();
  const unknown=encodeObservation(view,view.legalActions).observation;
  view.players[0].deck[0][0]=0;view.players[0].knownCardPositions[0][0]=true;
  const zero=encodeObservation(view,view.legalActions).observation;
  assert.notDeepEqual(zero,unknown);assert.equal(zero[1],1);assert.equal(unknown[1],0);
  assert.equal(zero[2],1);
});
test('ML public memory resets between rounds and cannot read hidden cards',()=>{
  const view=observation(),memory=new PublicMemory();view.phase='pick up card';view.activePlayerId='p0';
  memory.observe(view);assert.equal(memory.stagnant,0);
  view.turn++;memory.observe(view);assert.equal(memory.stagnant,1);
  view.round++;memory.observe(view);assert.equal(memory.stagnant,0);
});

test('verified ML artifact registers as an independent strategy and runs through the real runner',
  {skip:!process.env.SKYLO_ML_TEST_MANIFEST},async()=>{
    const {configureML}=require('../src/game/ml/configureML');
    const {createBot,botCatalog}=require('../src/game/bots');
    const {GameRunner}=require('../src/game/runtime/GameRunner');
    const {verifyRecord}=require('../src/game/recording/verifyRecord');
    const unregister=configureML({SKYLO_ML_MANIFEST:process.env.SKYLO_ML_TEST_MANIFEST});
    try {
      const entry=botCatalog().find(x=>x.id==='ml');
      assert.ok(entry&&entry.available);
      const config={strategyId:'ml',version:entry.version,profile:'trained'};
      assert.equal(createBot(config).id,'ml');
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('ML runner smoke timeout')),10000);
        const runner=new GameRunner({matchId:'ml-smoke',sessionId:'test',seed:'ml-smoke',maxActions:20,
          players:[{id:'p0',name:'Model',kind:'bot',botConfig:config},
                   {id:'p1',name:'Hard',kind:'bot',botConfig:{strategyId:'rules',difficulty:'hard',version:'1'}}]},
          {delayMs:0,onEnd:()=>{
            clearTimeout(timer);
            try {
              const record=runner.exportRecord();
              assert.ok(record.actions.some(a=>a.playerId==='p0'&&a.diagnostics?.source==='model'));
              assert.ok(record.actions.every(a=>!a.fallback));
              const replay=verifyRecord(record);
              assert.equal(replay.valid,true,replay.error);resolve();
            }catch(error){reject(error)}
          }});
        runner.start();
      });
    } finally {unregister()}
  });
