/* Auxiliary public-information teacher experiment. The reference hard bot stays unchanged. */
const fs=require('node:fs');
const {GameCore}=require('../dist/game/core/GameCore');
const {createRandom}=require('../dist/game/core/random');
const {RuleBot}=require('../dist/game/bots/rules');
const {RULE_VERSION}=require('../dist/protocol/gameProtocol');
const {PlanningTeacher,PatientTeacher,MatchTeacher}=require('../../../ml/planning_teacher.cjs');
const defaultConfigurations=[
  {pairs:1,information:.4,endRisk:1},
  {pairs:2,information:.4,endRisk:1},
  {pairs:4,information:.4,endRisk:1},
  {pairs:8,information:.4,endRisk:1},
  {pairs:4,information:.15,endRisk:1},
  {pairs:4,information:.8,endRisk:1},
  {pairs:4,information:.4,endRisk:.25},
  {pairs:4,information:.4,endRisk:2},
];
const configurations=process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4],'utf8')):defaultConfigurations;
const namespace=process.argv[5]||'teacher-search-training-v1';
const games=Number(process.argv[2]||100);
const output=process.argv[3];
const baseline=new RuleBot('hard');
const baselineWeights=JSON.stringify(baseline.weights);
async function match(index,parameters){
 const seat=index%2,seed=`${namespace}:${Math.floor(index/2)}`;
 const core=new GameCore({matchId:'teacher-search',sessionId:'offline',seed,
   players:[0,1].map(i=>({id:`p${i}`,name:'Seat',kind:'bot'})),maxActions:100000});
 const strategies=[new RuleBot('hard'),new RuleBot('hard')];
 if(parameters.planner)strategies[seat]=new PlanningTeacher(parameters);
 if(parameters.patient)strategies[seat]=new PatientTeacher(parameters);
 if(parameters.matchAware)strategies[seat]=new MatchTeacher(parameters);
 // Replace the student's weights with an independent object. Never mutate shared constants.
 strategies[seat].weights={...strategies[seat].weights,...parameters};
 if(JSON.stringify(strategies[1-seat].weights)!==baselineWeights)throw Error('Reference opponent weights changed');
 while(core.state.phase!=='game ended'){
   if(core.state.phase==='new round'){core.apply('p0',{type:'next-round'});continue;}
   const id=core.eligiblePlayerIds()[0],active=id==='p0'?0:1;
   const observation={...core.view(),ownPlayerId:id,legalActions:core.legalActions(id)};
   const decision=await strategies[active].decide(observation,observation.legalActions,
     {signal:new AbortController().signal,random:createRandom(`${seed}:bot:seat${active}:${core.state.revision}`),
      budget:{maxMs:1000,maxIterations:1000},publicRules:{ruleVersion:RULE_VERSION,pointLimit:100,maxRounds:100,maxActions:100000}});
   if(!core.apply(id,decision.action).accepted)throw Error('Illegal teacher action');
 }
 const score=core.state.players[seat].totalPoints,other=core.state.players[1-seat].totalPoints;
 return {win:score<other,draw:score===other,difference:other-score,endReason:core.state.endReason};
}
(async()=>{
 const summaries=[];
 for(const config of configurations){
  const results=[];const start=performance.now();
  for(let i=0;i<games;i++)results.push(await match(i,config));
  const summary={config,games,winRate:results.filter(r=>r.win).length/games,
    meanDifference:results.reduce((s,r)=>s+r.difference,0)/games,
    natural:results.filter(r=>r.endReason==='point-limit').length,seconds:(performance.now()-start)/1000};
  summaries.push(summary);console.log(JSON.stringify(summary));
 }
 if(output)fs.writeFileSync(output,JSON.stringify(summaries,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
