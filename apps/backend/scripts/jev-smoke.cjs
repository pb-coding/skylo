#!/usr/bin/env node
/** Explicitly opt-in live validation. Authenticated model listing also counts toward the cap. */
const fs = require('node:fs');
const path = require('node:path');
const { TypeSafeClient, APIError } = require('@typesafe-ai/sdk');
const { JevBot } = require('../src/game/bots/jev');
const { JevProvider, JevFailure, FileRequestLedger } = require('../src/game/bots/jevProvider');
const { GameCore } = require('../src/game/core');
const { RULE_VERSION } = require('../src/protocol/gameProtocol');
const maximum = Number(process.argv[process.argv.indexOf('--max-api-calls') + 1]);
if (!process.argv.includes('--live') || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10) {
  console.error('Usage: node --require ts-node/register scripts/jev-smoke.cjs --live --max-api-calls 10');
  process.exit(2);
}
const directory = path.resolve(process.env.SKYLO_SMOKE_DIR || '.cache/jev-smoke');
fs.mkdirSync(directory, { recursive:true });
const ledger = new FileRequestLedger(path.join(directory,'usage.json'));
const report = { model:'jev-1.13.0', startedAt:new Date().toISOString(), requestCap:maximum, callsBefore:ledger.used, checks:[] };
const settings = { model:report.model,timeoutMs:15000,maxRequests:maximum,maxRequestsPerMatch:maximum,concurrency:1,failureThreshold:2,cooldownMs:60000 };
function context() { return { signal:new AbortController().signal,random:()=>0.5,budget:{ maxMs:15000,maxIterations:1000 },remoteUsage:{ requests:0 },
  publicRules:{ ruleVersion:RULE_VERSION,pointLimit:57,maxRounds:4,maxActions:1000 } }; }
async function main() {
  const client = new TypeSafeClient({ baseURL:'https://api.typesafe.ai', retry:{ maxRetries:0 },logLevel:'off',timeout:15000 });
  ledger.reserve(maximum);
  const models = await client.models.list();
  report.checks.push({ check:'Authenticated model listing',models:models.map(model=>model.name) });
  const provider = new JevProvider(settings,ledger,process.env.TYPESAFE_API_KEY);
  const core = new GameCore({ matchId:'smoke',sessionId:'smoke',seed:'not-sent',players:['a','b'].map(id=>({ id,name:id,kind:'human' })) });
  const opening = { ...core.view(),ownPlayerId:'a',legalActions:core.legalActions('a') };
  const closing = JSON.parse(JSON.stringify(opening));
  closing.phase='place card';closing.activePlayerId='a';
  const own=closing.players[0];own.deck=[[4,4,null]];own.slotIds=[['c0r0','c0r1','c0r2']];own.knownCardPositions=[[true,true,false]];own.cardCache=0;
  closing.players[1].deck=[[1,2,null]];closing.players[1].slotIds=[['o0r0','o0r1','o0r2']];closing.players[1].knownCardPositions=[[true,true,false]];
  closing.legalActions=[...own.slotIds[0].map(slotId=>({ type:'place',slotId })),{ type:'discard' }];
  for(const [name,observation] of [['Opening: 12 hidden-card choices',opening],['Closing: last hidden card or safer alternatives',closing]]) {
    if(ledger.used >= maximum) break;
    const result=await new JevBot(provider).decide(observation,observation.legalActions,context());
    if(!observation.legalActions.includes(result.action)) throw new Error('Illegal smoke action');
    report.checks.push({ check:name,action:result.action,diagnostics:result.diagnostics });
  }
  report.passed=true;
}
main().catch(error=>{
  report.passed=false;
  report.failure=error instanceof JevFailure?error.reason:error instanceof APIError?`HTTP ${error.status}`:error.constructor.name;
  console.error(`Live validation failed: ${report.failure}`);process.exitCode=1;
}).finally(()=>{
  report.callsAfter=ledger.used;report.callsThisRun=report.callsAfter-report.callsBefore;
  report.inputTokens=report.checks.reduce((sum,check)=>sum+(check.diagnostics?.inputTokens||0),0);
  report.outputTokens=report.checks.reduce((sum,check)=>sum+(check.diagnostics?.outputTokens||0),0);
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
});
