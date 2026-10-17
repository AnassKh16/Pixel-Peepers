import { isObject, validId, validationError } from './validation.js';
import { swiss } from './swiss.js';
import { bracketMatch, seededFirstRound, resolveBracket } from './brackets.js';
import { doubleElimination } from './double-elimination.js';
const limits={round_robin:[2,40],single_elim:[2,128],swiss:[2,64],double_elim:[3,128]};
export function validateFixtures(body) {
  if (!isObject(body)) validationError(['body']);
  const fields=[];
  const known=typeof body.format==='string'&&Object.hasOwn(limits,body.format);
  if (!known) fields.push('format');
  if (!Array.isArray(body.teams)||body.teams.some(team=>!validId(team))||new Set(body.teams).size!==body.teams.length) fields.push('teams');
  else if (known&&(body.teams.length<limits[body.format][0]||body.teams.length>limits[body.format][1])) fields.push('teams');
  if (body.params!==undefined&&!isObject(body.params)) fields.push('params');
  if (fields.length) validationError(fields);
  return {format:body.format,teams:[...body.teams],params:body.params??{}};
}
function roundRobin(teams,params) {
  const legs=(params.legs===undefined?1:params.legs),perLeg=teams.length%2?teams.length:teams.length-1,roundCount=perLeg*([1,2].includes(legs)?legs:1);
  const withdrawals=(params.withdrawals===undefined?[]:params.withdrawals),policy=(params.withdrawal_policy===undefined?'forfeit_remaining':params.withdrawal_policy),fields=[],withdrawn=new Map();
  if (![1,2].includes(legs)) fields.push('params.legs');
  if (!['forfeit_remaining','void_all'].includes(policy)) fields.push('params.withdrawal_policy');
  if (!Array.isArray(withdrawals)) fields.push('params.withdrawals');
  else withdrawals.forEach((item,index)=>{
    if (!isObject(item)||!teams.includes(item.team_id)||withdrawn.has(item.team_id)||!Number.isSafeInteger(item.after_round)||item.after_round<0||item.after_round>roundCount) fields.push(`params.withdrawals.${index}`);
    else withdrawn.set(item.team_id,item.after_round);
  });
  if (fields.length) validationError(fields);
  const rounds=[],summary={total:0,scheduled:0,forfeit:0,voided:0},seed=new Map(teams.map((team,index)=>[team,index]));
  // An odd cyclic orientation balances all vertices; for even fields, remove one virtual vertex.
  const orientationSize=teams.length%2?teams.length:teams.length+1;
  for (let leg=1;leg<=legs;leg++) {
    let wheel=teams.length%2?[...teams,null]:[...teams];
    for (let local=1;local<=perLeg;local++) {
      const round=(leg-1)*perLeg+local,matches=[],byes=[];
      for (let i=0;i<wheel.length/2;i++) {
        let home=wheel[i],away=wheel[wheel.length-1-i];
        if (home===null||away===null) {byes.push(home??away);continue;}
        if ((seed.get(away)-seed.get(home)+orientationSize)%orientationSize>Math.floor(orientationSize/2)) [home,away]=[away,home];
        if (leg===2) [home,away]=[away,home];
        let status='scheduled',awarded_to=null;
        const h=withdrawn.has(home),a=withdrawn.has(away);
        if ((h&&a)||(policy==='void_all'&&(h||a))) status='voided';
        else if ((h&&round>withdrawn.get(home))||(a&&round>withdrawn.get(away))) {status='forfeit';awarded_to=h?away:home;}
        matches.push({match_id:`RR-L${leg}-R${round}-M${matches.length+1}`,leg,home,away,status,awarded_to});
        summary.total++;summary[status]++;
      }
      rounds.push({round,matches,byes});wheel=[wheel[0],wheel[wheel.length-1],...wheel.slice(1,-1)];
    }
  }
  return {format:'round_robin',legs,team_count:teams.length,round_count:roundCount,rounds,summary};
}
function singleElimination(teams,params) {
  if (params.third_place_match!==undefined&&typeof params.third_place_match!=='boolean') validationError(['params.third_place_match']);
  const size=2**Math.ceil(Math.log2(teams.length)),count=Math.log2(size);
  const rounds=Array.from({length:count},(_,r)=>({round:r+1,matches:Array.from({length:size/2**(r+1)},(_,i)=>bracketMatch(`R${r+1}M${i+1}`,'main',r+1,i+1))}));
  for (let r=0;r<count-1;r++) for (const match of rounds[r].matches) match.winner_to={match_id:`R${r+2}M${Math.ceil(match.index/2)}`,slot:match.index%2?'home':'away'};
  seededFirstRound(rounds[0].matches,teams,size);
  const initial=new Set(rounds[0].matches.map(match=>match.match_id));
  if (params.third_place_match) {
    rounds[count-1].matches.push(bracketMatch('TP','third_place',count,1));
    if (count>1) rounds[count-2].matches.forEach((match,index)=>{match.loser_to={match_id:'TP',slot:index===0?'home':'away'};});
  }
  resolveBracket(rounds.flatMap(round=>round.matches),initial,teams,params.results);
  return {format:'single_elim',bracket_size:size,rounds};
}
export function generateFixtures(body) {
  const {format,teams,params}=validateFixtures(body);
  if (format==='round_robin') return roundRobin(teams,params);
  if (format==='single_elim') return singleElimination(teams,params);
  if (format==='swiss') return swiss(teams,params);
  return doubleElimination(teams,params);
}
