/* Independent, deployment-runtime evaluation. No Python learner/rollout adapter. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {GameCore}=require('../dist/game/core/GameCore');
const {createRandom}=require('../dist/game/core/random');
const {RuleBot}=require('../dist/game/bots/rules');
const {MLBot,readModelManifest}=require('../dist/game/ml/MLBot');
const {RULE_VERSION}=require('../dist/protocol/gameProtocol');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i===-1?fallback:args[i+1];};
const manifestPath=option('--manifest');
const games=Number(option('--games','2000'));
const namespace=option('--namespace');
const output=option('--output');
if(!manifestPath||!namespace||!output||!Number.isInteger(games)||games<2||games%2) throw Error('Need manifest, namespace, output, and even game count');
if(fs.existsSync(output)) throw Error('Evaluation output already exists; preserve prior results');
const root=path.resolve(__dirname,'../../..');
execFileSync('git',['diff','--exit-code','64a57af86be65a6d59e6a230762a76aecd36084d','--',
  'apps/backend/src/game/core/GameCore.ts','apps/backend/src/game/core/random.ts',
  'apps/backend/src/game/bots/rules.ts','apps/backend/src/protocol/gameProtocol.ts'],{cwd:root});
const manifest=readModelManifest(manifestPath);
const results=[];
const latencies=[];
const started=performance.now();
async function match(index){
  const seed=`${namespace}:${Math.floor(index/2)}`,seat=index%2;
  const core=new GameCore({matchId:`proof-${index}`,sessionId:'proof',seed,
    players:[0,1].map(i=>({id:`p${i}`,name:`Seat ${i}`,kind:'bot'})),pointLimit:100,maxRounds:100,maxActions:100000});
  const strategies=[0,1].map(i=>i===seat?new MLBot(manifest.modelPath,manifest.version):new RuleBot('hard'));
  while(core.state.phase!=='game ended'){
    if(core.state.phase==='new round'){core.apply('p0',{type:'next-round'});continue;}
    const playerId=core.eligiblePlayerIds()[0],active=playerId==='p0'?0:1;
    const observation={...core.view(),ownPlayerId:playerId,legalActions:core.legalActions(playerId)};
    const context={signal:new AbortController().signal,random:createRandom(`${seed}:bot:seat${active}:${core.state.revision}`),
      budget:{maxMs:1000,maxIterations:1000},publicRules:{ruleVersion:RULE_VERSION,pointLimit:100,maxRounds:100,maxActions:100000}};
    const before=performance.now();
    const decision=await strategies[active].decide(observation,observation.legalActions,context);
    if(active===seat)latencies.push(performance.now()-before);
    if(!core.apply(playerId,decision.action).accepted)throw Error('Illegal action in deployed policy');
  }
  strategies.forEach(x=>x.dispose());
  const score=core.state.players[seat].totalPoints,otherScore=core.state.players[1-seat].totalPoints;
  return {index,seed,seat,score,otherScore,win:score<otherScore,draw:score===otherScore,
    endReason:core.state.endReason,rounds:core.state.round,actions:core.state.actionCount,fingerprint:core.fingerprint()};
}
(async()=>{
  for(let index=0;index<games;index++){
    results.push(await match(index));
    if((index+1)%100===0)console.log(JSON.stringify({stage:'deployed-evaluation',games:index+1,wins:results.filter(r=>r.win).length,
      winRate:results.filter(r=>r.win).length/results.length,seconds:(performance.now()-started)/1000}));
  }
  latencies.sort((a,b)=>a-b);
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const report={model:manifest.version,modelSha256:manifest.sha256,ruleVersion:RULE_VERSION,namespace,games,
    wins:results.filter(r=>r.win).length,draws:results.filter(r=>r.draw).length,
    winRate:results.filter(r=>r.win).length/games,natural:results.filter(r=>r.endReason==='point-limit').length,
    seatWinRates:[0,1].map(seat=>results.filter(r=>r.seat===seat&&r.win).length/(games/2)),
    latencyMs:{median:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.floor(latencies.length*.95)],max:latencies[latencies.length-1]},
    elapsedSeconds:(performance.now()-started)/1000,
    coreSha256:hash(path.resolve(__dirname,'../src/game/core/GameCore.ts')),
    hardBotSha256:hash(path.resolve(__dirname,'../src/game/bots/rules.ts')),records:results};
  fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({...report,records:undefined}));
})().catch(error=>{console.error(error);process.exitCode=1});
