/* Training-only expert: finite-horizon column values, using a public card prior.
   The deployed neural policy does not import this module. */
const {RuleBot}=require('../apps/backend/dist/game/bots/rules');
const tables=new Map();
const prior=Array.from({length:15},(_,i)=>(i===0?5:i===2?15:10)/150);
const mean=prior.reduce((s,p,i)=>s+p*(i-2),0);
const key=column=>{
 let a=column[0]===null?0:column[0]+3,b=column[1]===null?0:column[1]+3,c=column[2]===null?0:column[2]+3,t;
 if(a>b){t=a;a=b;b=t}if(b>c){t=b;b=c;c=t}if(a>b){t=a;a=b;b=t}
 return a+16*b+256*c;
};
function values(horizon){
 if(tables.has(horizon))return tables.get(horizon);
 const states=[];
 for(let a=0;a<16;a++)for(let b=a;b<16;b++)for(let c=b;c<16;c++)states.push([a,b,c]);
 let value=new Float64Array(4096);
 for(const state of states){
  const index=state[0]+16*state[1]+256*state[2];
  value[index]=state[0]>0&&state[0]===state[2]?0:state.reduce((s,x)=>s+(x===0?mean:x-3),0);
 }
 for(let h=0;h<horizon;h++){
  const next=new Float64Array(4096);
  for(const state of states){
   const index=state[0]+16*state[1]+256*state[2];
   if(state[0]>0&&state[0]===state[2])continue;
   let total=0;
   for(let v=0;v<15;v++){
    let best=value[index];
    for(let i=0;i<3;i++){
     const after=[...state];after[i]=v+1;after.sort((a,b)=>a-b);
     best=Math.min(best,value[after[0]+16*after[1]+256*after[2]]);
    }
    total+=prior[v]*best;
   }
   next[index]=total;
  }
  value=next;
 }
 tables.set(horizon,value);return value;
}
const hidden=deck=>deck.flat().filter(x=>x===null).length;
const expected=(deck,mean)=>deck.flat().reduce((s,x)=>s+(x===null?mean:x),0);
function replace(deck,position,card){
 const after=deck.map(c=>[...c]);const [c,r]=position;after[c][r]=card;
 if(after[c].every(x=>x===card))after.splice(c,1);
 return after;
}
class PlanningTeacher extends RuleBot{
 constructor(parameters){
  super('hard');
  this.weights={...this.weights,...parameters};
  this.table=values(parameters.horizon??3);
  this.futureWeight=parameters.futureWeight??1;
 }
 utility(deck){return deck.reduce((s,c)=>s+this.table[key(c)],0)}
 gain(before,after,distribution){
  const immediate=expected(before,distribution.mean)-expected(after,distribution.mean);
  const priorImmediate=expected(before,mean)-expected(after,mean);
  return immediate+this.futureWeight*(this.utility(before)-this.utility(after)-priorImmediate);
 }
 placementScore(position,card,observation,deck,distribution){
  const after=replace(deck,position,card);
  return this.gain(deck,after,distribution)+(deck[position[0]][position[1]]===null?this.informationReward():0)
   -this.closingPenalty(observation,after,distribution);
 }
 revealScore(position,observation,deck,distribution){
  return this.informationReward()+distribution.cards.reduce((s,card)=>{
   const after=replace(deck,position,card.value);
   return s+card.probability*(this.gain(deck,after,distribution)-this.closingPenalty(observation,after,distribution));
  },0);
 }
}
class PatientTeacher extends RuleBot{
 constructor(parameters){super('hard');this.weights={...this.weights,...parameters};this.parameters=parameters}
 informationReward(){
  return this.weights.information+Math.max(0,(this.progress?.stagnant??0)-(this.parameters.informationPatience??12))*.3;
 }
 closingPenalty(observation,deck,distribution){
  const progress=this.progress;
  try{
   if(progress)this.progress={...progress,stagnant:0};
   return super.closingPenalty(observation,deck,distribution)*Math.max(0,1-(progress?.stagnant??0)/(this.parameters.closingPatience??32));
  }finally{this.progress=progress}
 }
}
class MatchTeacher extends PatientTeacher{
 closingPenalty(observation,deck,distribution){
  const penalty=super.closingPenalty(observation,deck,distribution);
  if(hidden(deck)>0||observation.players.some(p=>p.closedRound))return penalty;
  const own=observation.players.find(p=>p.id===observation.ownPlayerId),other=observation.players.find(p=>p.id!==observation.ownPlayerId);
  const otherDeck=other.deck.map((c,ci)=>c.map((v,r)=>other.knownCardPositions[ci][r]?v:null));
  const points=expected(deck,distribution.mean),otherMean=expected(otherDeck,distribution.mean)-2;
  const variance=hidden(otherDeck)*distribution.variance+4;
  let weight=0,balance=0;
  for(let y=-24;y<=144;y++){
   const probability=Math.exp(-((y-otherMean)**2)/(2*variance));
   weight+=probability;
   const ownTotal=own.totalPoints+(points>0&&points>=y?2*points:points),otherTotal=other.totalPoints+y;
   if(Math.max(ownTotal,otherTotal)>=100)balance+=probability*Math.sign(otherTotal-ownTotal);
  }
  return penalty-(this.parameters.matchBonus??30)*balance/weight;
 }
}
module.exports={PlanningTeacher,PatientTeacher,MatchTeacher};
