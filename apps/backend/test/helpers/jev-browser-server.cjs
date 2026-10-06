// Browser fixture: actual server + Jev adapter/SDK with a fake fetch. Never uses the real key.
const { startServer, io } = require('../../src/server');
const { registerBotStrategy } = require('../../src/game/bots');
const { JevBot } = require('../../src/game/bots/jev');
const { JevProvider, MemoryRequestLedger } = require('../../src/game/bots/jevProvider');
let requests = 0;
let releaseFirstDecision;
io.on('connection', socket => socket.on('playback-control', payload => {
  if (payload?.command?.type === 'pause') releaseFirstDecision?.();
}));
const provider = new JevProvider({ model:'jev-1.13.0',timeoutMs:15000,maxRequests:10,maxRequestsPerMatch:10,concurrency:1,failureThreshold:2,cooldownMs:60000 },new MemoryRequestLedger(),'browser-fixture-key',async (_url,init)=>{
  const current = ++requests;
  const body=JSON.parse(init.body);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(resolve,current === 1 ? 15000 : 100);
    if (current === 1) releaseFirstDecision = () => { clearTimeout(timer); resolve(); };
    init.signal.addEventListener('abort',()=>{ clearTimeout(timer);reject(new Error('Cancelled fixture')); },{ once:true });
  });
  if(current > 1) return new Response('{}',{ status:429,headers:{ 'content-type':'application/json' } });
  const ids=Object.keys(body.questions.action.criteria);
  return new Response(JSON.stringify({ model:'jev-1.13.0',usage:{ input_tokens:100,output_tokens:20 },answers:{ action:{ type:'choice',choice:ids[0],confidence:0.9,probabilities:Object.fromEntries(ids.map(id=>[id,id===ids[0]?1:0])) } } }),{ headers:{ 'content-type':'application/json' } });
});
registerBotStrategy({ id:'typesafe-jev-choice',version:'browser-fixture',name:'Jev · TypeSafe',profiles:[{ id:'choice',name:'Jev Choice' }],availability:()=>({ available:true }),factory:()=>{
  const bot=new JevBot(provider);Object.defineProperty(bot,'version',{ value:'browser-fixture' });return bot;
} });
startServer().catch(()=>{console.error('Browser fixture failed to start');process.exitCode=1;});
