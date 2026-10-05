const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { JevBot } = require('../src/game/bots/jev');
const { JevProvider, JevFailure, MemoryRequestLedger, FileRequestLedger } = require('../src/game/bots/jevProvider');
const { buildJevCandidates, buildJevState, jevContextHash } = require('../src/game/bots/jevState');
const { readJevSettings } = require('../src/game/bots/configureJev');
const { GameRunner } = require('../src/game/runtime/GameRunner');
const { GameCore } = require('../src/game/core');
const { verifyRecord } = require('../src/game/recording');
const rules = { ruleVersion:'skylo-2-positive-penalty', pointLimit:57, maxRounds:4, maxActions:1000 };
const settings = { model:'jev-1.13.0', timeoutMs:2000, maxRequests:10, maxRequestsPerMatch:4, concurrency:2, failureThreshold:2, cooldownMs:5000 };
const ctx = (extra={}) => ({ signal:new AbortController().signal, random:()=>0.5, budget:{ maxMs:2000,maxIterations:1000 }, publicRules:rules, remoteUsage:{ requests:0 }, ...extra });
const config = (extra={}) => ({ matchId:'jev-test',sessionId:'table',seed:'secret-seed-never-send',players:['a','b'].map(id=>({ id,name:`private-name-${id}`,kind:'bot',botConfig:{ strategyId:'rules',difficulty:'medium' } })), ...extra });
function view() { const core=new GameCore(config()); return { ...core.view(),ownPlayerId:'a',legalActions:core.legalActions('a') }; }
function placement(cards, cache=0) {
  const observation=view(), own=observation.players[0]; observation.phase='place card'; observation.activePlayerId='a';
  own.deck=cards; own.slotIds=cards.map((_,c)=>[0,1,2].map(r=>`a:${c}:${r}`)); own.knownCardPositions=cards.map(col=>col.map(v=>v!==null)); own.cardCache=cache;
  observation.legalActions=[...own.slotIds.flat().map(slotId=>({ type:'place',slotId })),{ type:'discard' }]; return observation;
}
const response=(body,status=200)=>new Response(JSON.stringify(body),{ status,headers:{ 'content-type':'application/json','x-typesafe-request-id':'test-request' } });
function answer(request,chosen=Object.keys(request.questions.action.criteria)[0]) { return { model:'jev-1.13.0',usage:{ input_tokens:250,output_tokens:18 },answers:{ action:{ type:'choice',choice:chosen,confidence:0.8,probabilities:Object.fromEntries(Object.keys(request.questions.action.criteria).map(id=>[id,id===chosen?1:0])) } } }; }
function mockProvider(handler,overrides={},ledger=new MemoryRequestLedger(),now) {
  const requests=[]; const provider=new JevProvider({ ...settings,...overrides },ledger,'fake-test-key',async(url,init)=>{
    const request=JSON.parse(init.body); requests.push({ url,request,signal:init.signal }); return handler(request,init.signal);
  },now); return { provider,ledger,requests };
}
const flush=async()=>{ for(let i=0;i<25;i++) await Promise.resolve(); await new Promise(resolve=>setImmediate(resolve)); };
class Clock {
  time=0; sequence=0; timers=new Map(); now=()=>this.time;
  setTimeout=(callback,delay)=>{ const id=++this.sequence; this.timers.set(id,{ callback,due:this.time+delay }); return id; };
  clearTimeout=id=>this.timers.delete(id);
  async advance(ms) { const target=this.time+ms; await flush(); for(let i=0;i<1000;i++) {
    const next=[...this.timers].sort((a,b)=>a[1].due-b[1].due)[0];
    if(!next||next[1].due>target) { this.time=target; await flush(); return; }
    this.time=next[1].due; this.timers.delete(next[0]); next[1].callback(); await flush();
  } assert.fail('Too many callbacks'); }
}
test('Jev remasks hidden values, omits names/seed/extra fields, and supplies actual public limits',()=>{
  const observation=view(); observation.players[0].deck[0][0]=12; observation.players[0].roundPoints=999;
  observation.seed='secret-seed-never-send'; observation.secret='do-not-send';
  const candidates=buildJevCandidates(observation,observation.legalActions), state=buildJevState(observation,rules,candidates), serialized=JSON.stringify(state);
  for(const secret of ['private-name-','secret-seed-never-send','do-not-send','999']) assert.equal(serialized.includes(secret),false);
  assert.equal(state.self.columns[0][0],null); assert.equal(state.self.visibleRoundPoints,0); assert.equal(state.rules.pointLimit,57);
  assert.equal(state.rules.maxRounds,4); assert.equal(state.rules.maxActions,1000); assert.equal(state.candidates.length,12);
  assert.equal(jevContextHash(state,{ a0:'x' }).length,64);
  assert.throws(()=>buildJevState(observation,{ ...rules,ruleVersion:'other' },candidates),/Unsupported/);
});
test('candidate facts handle negative/zero triples, unknown replacements and intentional closing',()=>{
  for(const card of [-2,0,7]) { const observation=placement([[card,card,null]],card), candidate=buildJevCandidates(observation,observation.legalActions)[2];
    assert.equal(candidate.consequences.removedColumn,1); assert.equal(candidate.consequences.exactOwnRoundPointsAfter,0);
    assert.equal(candidate.consequences.closesRound,true); assert.equal(candidate.consequences.previousCard,null); assert.match(candidate.description,/doubles only positive.*ties/);
  }
  for(const cards of [[-2,-1,null],[0,0,null],[4,4,null]]) { const observation=placement([cards],1), facts=buildJevCandidates(observation,observation.legalActions)[2].consequences;
    assert.equal(facts.exactOwnRoundPointsAfter,cards[0]+cards[1]+1); assert.equal(facts.closesRound,true); assert.equal(facts.removedColumn,null);
  }
});
test('reveals do not invent values or guaranteed triples; final turn order and initial phase remain correct',()=>{
  const observation=placement([[8,8,null]]); observation.phase='reveal card'; observation.legalActions=[{ type:'reveal',slotId:'a:0:2' }];
  let facts=buildJevCandidates(observation,observation.legalActions)[0].consequences;
  assert.equal(facts.visiblePointsAfter,null); assert.equal(facts.removedColumn,null); assert.equal(facts.possibleTripleValue,8); assert.equal(facts.closesRound,true);
  observation.players[1].closedRound=true; facts=buildJevCandidates(observation,observation.legalActions)[0].consequences; assert.equal(facts.closesRound,false);
  const state=buildJevState(observation,rules,buildJevCandidates(observation,observation.legalActions)); assert.deepEqual(state.roundStatus.finalTurnsRemaining,[0]);
  observation.phase='reveal two cards'; observation.players[1].closedRound=false;
  assert.equal(buildJevCandidates(observation,observation.legalActions)[0].consequences.closesRound,false);
});
test('pickup and discard describe staged decisions and the must-place rule',()=>{
  const observation=placement([[null,null,null]],12); observation.discardPile=[0];
  const candidates=buildJevCandidates(observation,[{ type:'draw' },{ type:'take-discard' },{ type:'discard' }]);
  assert.equal(candidates[0].consequences.pickedUpCard,null); assert.equal(candidates[1].consequences.pickedUpCard,0);
  assert.match(candidates[1].description,/must then be placed/); assert.equal(candidates[2].consequences.closesRound,false); assert.match(candidates[2].description,/separate decision/);
});
test('SDK transport sends all candidates, maps Choice, keeps bounded public history and does not mutate input',async()=>{
  const mock=mockProvider(request=>response(answer(request,'a5'))),bot=new JevBot(mock.provider),observation=view(),before=JSON.stringify(observation);
  for(let i=0;i<40;i++) bot.onEvent({ type:'card-drawn',playerId:'b',data:{ card:5,seed:'bad',secret:'bad' } },observation);
  const result=await bot.decide(observation,observation.legalActions,ctx());
  assert.equal(result.action,observation.legalActions[5]); assert.equal(result.diagnostics.source,'model'); assert.equal(result.diagnostics.inputTokens,250); assert.equal(result.diagnostics.requestId,'test-request');
  assert.equal(mock.requests[0].url,'https://api.typesafe.ai/v1/systemone'); assert.equal(Object.keys(mock.requests[0].request.questions.action.criteria).length,12);
  assert.equal(mock.requests[0].request.state.publicHistory.length,32); assert.equal(JSON.stringify(mock.requests[0].request.state).includes('bad'),false); assert.equal(JSON.stringify(observation),before);
  bot.dispose(); await assert.rejects(bot.decide(observation,observation.legalActions,ctx()),{ name:'AbortError' });
});
test('a single legal action bypasses the API and consumes no model or match budget',async()=>{
  const mock=mockProvider(()=>{throw new Error('Must not call');},{ maxRequests:0 }),context=ctx();
  const result=await new JevBot(mock.provider).decide(view(),[{ type:'draw' }],context);
  assert.equal(result.diagnostics.source,'automatic'); assert.equal(mock.requests.length,0); assert.equal(context.remoteUsage.requests,0); assert.equal(mock.ledger.used,0);
});
test('Choice rejects unknown/missing options, invalid distributions/confidence and malformed model/usage',async()=>{
  for(const mutate of [b=>b.answers.action.choice='a999',b=>delete b.answers.action.probabilities.a1,b=>b.answers.action.probabilities.a1=0.5,b=>b.answers.action.probabilities.a1=-0.1,b=>b.answers.action.confidence=2,b=>b.answers.action=null,b=>b.model='',b=>b.usage.input_tokens=-1,b=>b.usage=null]) {
    const mock=mockProvider(request=>{const body=answer(request);mutate(body);return response(body);}),observation=view();
    await assert.rejects(new JevBot(mock.provider).decide(observation,observation.legalActions,ctx()),e=>e instanceof JevFailure&&e.reason==='invalid-response'); assert.equal(mock.ledger.used,1);
  }
  const mock=mockProvider(request=>{const body=answer(request);body.answers.action.confidence=0;return response(body);}),observation=view();
  assert.equal((await new JevBot(mock.provider).decide(observation,observation.legalActions,ctx())).diagnostics.source,'model');
});
test('provider errors are safe, retries are disabled and circuit breaker suppresses requests until cooldown',async()=>{
  let now=0; const mock=mockProvider(()=>response({ message:'secret-provider-body' },429),{},undefined,()=>now),bot=new JevBot(mock.provider),observation=view(),context=ctx();
  for(let i=0;i<2;i++) await assert.rejects(bot.decide(observation,observation.legalActions,context),e=>{assert.equal(JSON.stringify(e.diagnostics).includes('secret-provider-body'),false);return e.reason==='rate-limit';});
  await assert.rejects(bot.decide(observation,observation.legalActions,context),e=>e.reason==='circuit-open'); assert.equal(mock.requests.length,2); assert.equal(context.remoteUsage.requests,2);
  now=5001; await assert.rejects(bot.decide(observation,observation.legalActions,context),e=>e.reason==='rate-limit'); assert.equal(mock.requests.length,3);
  for(const [status,reason] of [[401,'authentication'],[403,'authentication'],[500,'provider']]) { const failure=mockProvider(()=>response({},status));
    await assert.rejects(new JevBot(failure.provider).decide(observation,observation.legalActions,ctx()),e=>e.reason===reason);assert.equal(failure.requests.length,1);
  }
});
test('global and shared per-match caps prevent excess dispatches',async()=>{
  const mock=mockProvider(request=>response(answer(request)),{ maxRequests:3,maxRequestsPerMatch:2 }),observation=view(),shared={ requests:0 },bots=[new JevBot(mock.provider),new JevBot(mock.provider)];
  await bots[0].decide(observation,observation.legalActions,ctx({ remoteUsage:shared })); await bots[1].decide(observation,observation.legalActions,ctx({ remoteUsage:shared }));
  await assert.rejects(bots[0].decide(observation,observation.legalActions,ctx({ remoteUsage:shared })),e=>e.reason==='budget-exhausted');
  await bots[0].decide(observation,observation.legalActions,ctx()); await assert.rejects(bots[0].decide(observation,observation.legalActions,ctx()),e=>e.reason==='budget-exhausted');
  assert.equal(mock.requests.length,3);assert.equal(mock.ledger.used,3);assert.equal(mock.provider.availability().available,false);
});
test('scheduler bounds concurrency and cancels queued requests without spending budget',async()=>{
  const releases=[],mock=mockProvider(request=>new Promise(resolve=>releases.push(()=>resolve(response(answer(request))))),{ concurrency:1 }),observation=view(),bot=new JevBot(mock.provider);
  const first=bot.decide(observation,observation.legalActions,ctx());await flush();
  const controller=new AbortController(),second=bot.decide(observation,observation.legalActions,ctx({ signal:controller.signal })),rejection=assert.rejects(second,e=>e.reason==='aborted');
  const third=bot.decide(observation,observation.legalActions,ctx());await flush();assert.equal(mock.requests.length,1);
  controller.abort();await rejection;releases[0]();await first;await flush();assert.equal(mock.requests.length,2);releases[1]();await third;assert.equal(mock.ledger.used,2);
});
test('persistent request counter survives recreation and corrupt storage blocks usage',()=>{
  const directory=mkdtempSync(join(tmpdir(),'skylo-jev-budget-'));try { const path=join(directory,'usage.json');
    new FileRequestLedger(path).reserve(2);new FileRequestLedger(path).reserve(2);assert.equal(new FileRequestLedger(path).used,2);
    assert.throws(()=>new FileRequestLedger(path).reserve(2),e=>e.reason==='budget-exhausted');writeFileSync(path,'not-json');assert.throws(()=>new FileRequestLedger(path).reserve(2));
    assert.equal(mockProvider(()=>{throw new Error('no');},{},new FileRequestLedger(path)).provider.availability().available,false);
  } finally {rmSync(directory,{ recursive:true,force:true });}
});
test('settings default to disabled usage and reject malformed model/limits',()=>{
  assert.equal(readJevSettings({}).maxRequests,0);
  for(const env of [{ TYPESAFE_MAX_REQUESTS:'-1' },{ TYPESAFE_DECISION_TIMEOUT_MS:'NaN' },{ TYPESAFE_MODEL:'https://other' }]) assert.throws(()=>readJevSettings(env));
});
test('runner retains remote decisions through tempo and pause, records metadata and replays without provider calls',async()=>{
  let release;const mock=mockProvider(request=>new Promise(resolve=>{release=()=>resolve(response(answer(request,'a4')));})),clock=new Clock();
  const runner=new GameRunner(config({ maxActions:1,pointLimit:57 }),{ clock,delayMs:1000,strategyFactory:()=>new JevBot(mock.provider) });
  try {runner.start();await flush();assert.equal(runner.view(null,'spectator').playback.thinkingStrategyId,'typesafe-jev-choice');
    await clock.advance(500);runner.control({ type:'delay',delayMs:0 });runner.control({ type:'pause' });release();await clock.advance(0);
    assert.equal(runner.core.state.actionCount,0);assert.equal(mock.requests.length,1);runner.control({ type:'step-action' });await clock.advance(0);
    const record=runner.exportRecord();assert.equal(record.actions[0].diagnostics.source,'model');assert.equal(record.actions[0].decisionMs,500);assert.equal(record.actions[0].diagnostics.selectedCandidate,'a4');assert.equal(record.actions[0].fallback,false);
    assert.deepEqual(verifyRecord(record),{ valid:true,actions:1 });assert.equal(mock.requests.length,1);assert.equal(mock.requests[0].request.state.rules.pointLimit,57);
  } finally {runner.stop();}assert.equal(clock.timers.size,0);
});
test('remote timeout exceeds 1s local default, aborts transport and records a visible safe fallback',async()=>{
  const mock=mockProvider((_request,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{ once:true }))),clock=new Clock();
  const runner=new GameRunner(config({ maxActions:1 }),{ clock,delayMs:0,strategyFactory:()=>new JevBot(mock.provider) });
  runner.start();await flush();await clock.advance(1000);assert.equal(runner.core.state.actionCount,0);await clock.advance(1000);
  const record=runner.exportRecord();assert.equal(record.actions[0].fallback,true);assert.equal(record.actions[0].diagnostics.failure,'timeout');assert.equal(record.actions[0].diagnostics.requestedModel,'jev-1.13.0');
  assert.equal(runner.view(null,'spectator').lastDecision.fallback,true);assert.equal(verifyRecord(record).valid,true);assert.equal(mock.ledger.used,1);
});
test('stop aborts live SDK request and delayed output cannot change completed game',async()=>{
  let release;const mock=mockProvider(request=>new Promise(resolve=>{release=()=>resolve(response(answer(request)));})),clock=new Clock();
  const runner=new GameRunner(config(),{ clock,strategyFactory:()=>new JevBot(mock.provider) });runner.start();await flush();runner.stop();const fingerprint=runner.core.fingerprint();
  assert.equal(mock.requests[0].signal.aborted,true);release();await flush();await clock.advance(5000);assert.equal(runner.core.fingerprint(),fingerprint);assert.equal(runner.exportRecord().actions.length,0);assert.equal(mock.ledger.used,1);assert.equal(clock.timers.size,0);
});
test('v1 recordings remain replayable; v2 rejects malformed/unbounded diagnostics',async()=>{
  const clock=new Clock(),mock=mockProvider(request=>response(answer(request))),runner=new GameRunner(config({ maxActions:1 }),{ clock,delayMs:0,strategyFactory:()=>new JevBot(mock.provider) });
  runner.start();await clock.advance(0);const record=runner.exportRecord();assert.equal(record.schemaVersion,2);
  const old=JSON.parse(JSON.stringify(record));old.schemaVersion=1;old.actions.forEach(a=>delete a.diagnostics);assert.equal(verifyRecord(old).valid,true);
  for(const change of [d=>d.inputTokens=-1,d=>d.probabilities.a0=2,d=>d.contextHash='x',d=>d.responseBody='secret',d=>d.source='fallback']) {const copy=JSON.parse(JSON.stringify(record));change(copy.actions[0].diagnostics);assert.equal(verifyRecord(copy).valid,false);}
});

test('two Jev adapters complete multiple rounds through every action phase with SDK transport and offline replay',async()=>{
  const mock=mockProvider(request=>{
    const state=request.state;
    const candidates=state.candidates;
    let selected=candidates[0];
    if(state.phase==='pick up card') selected=candidates.find(candidate=>candidate.description.startsWith(state.turn%2?'Draw':'Take'))||selected;
    if(state.phase==='place card') selected=candidates.find(candidate=>candidate.description.startsWith('Discard'))||
      candidates.find(candidate=>candidate.consequences.previousCard===null)||selected;
    return response(answer(request,selected.id));
  },{ maxRequests:1000,maxRequestsPerMatch:1000 });
  const clock=new Clock();
  const specs=config().players.map(player=>({ ...player,botConfig:{ strategyId:'typesafe-jev-choice',profile:'choice',version:'1' } }));
  const runner=new GameRunner(config({ players:specs,maxRounds:2,pointLimit:100000,maxActions:500 }),{ clock,delayMs:0,strategyFactory:()=>new JevBot(mock.provider) });
  try {
    runner.start();await clock.advance(0);assert.equal(runner.disposed,true);assert.equal(runner.core.state.endReason,'round-limit');
    const record=runner.exportRecord();assert.equal(record.completion.round,2);
    const phases=new Set(record.actions.map(entry=>entry.action.type));
    for(const phase of ['draw','take-discard','discard','reveal','place','next-round']) assert.ok(phases.has(phase),phase);
    assert.ok(record.actions.some(entry=>entry.diagnostics?.source==='automatic'));
    assert.equal(record.actions.some(entry=>entry.fallback),false);
    const calls=mock.requests.length;assert.equal(verifyRecord(record).valid,true);assert.equal(mock.requests.length,calls);
    assert.equal(mock.ledger.used,calls);
  } finally {runner.stop();}
});

test('a match completes on medium-rule fallbacks after exhausting Jev budget, preserving selected profile and replay',async()=>{
  const mock=mockProvider(request=>response(answer(request)),{ maxRequests:3,maxRequestsPerMatch:3 }),clock=new Clock();
  const specs=config().players.map(player=>({ ...player,botConfig:{ strategyId:'typesafe-jev-choice',profile:'choice',version:'1' } }));
  const runner=new GameRunner(config({ players:specs,maxRounds:1,maxActions:500 }),{ clock,delayMs:0,strategyFactory:()=>new JevBot(mock.provider) });
  try {runner.start();await clock.advance(0);assert.equal(runner.disposed,true);assert.equal(runner.core.state.endReason,'round-limit');
    const record=runner.exportRecord();assert.equal(mock.requests.length,3);assert.ok(record.actions.some(entry=>entry.diagnostics?.failure==='budget-exhausted'));
    assert.ok(record.config.players.every(player=>player.botConfig.strategyId==='typesafe-jev-choice'&&player.botConfig.profile==='choice'));
    assert.equal(verifyRecord(record).valid,true);
  } finally {runner.stop();}
});
