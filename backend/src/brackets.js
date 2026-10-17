import { isObject, validId, validationError } from './validation.js';
export function seedOrder(size) {
  let order=[1,2];
  for (let current=4;current<=size;current*=2) order=order.flatMap(seed=>[seed,current+1-seed]);
  return order;
}
export function bracketMatch(match_id,bracket,round,index) {
  return {match_id,bracket,round,index,home:null,away:null,home_seed:null,away_seed:null,bye:false,winner:null,loser:null,winner_to:null,loser_to:null};
}
export function seededFirstRound(matches,teams,size) {
  const order=seedOrder(size);
  matches.forEach((match,index)=>{
    const pair=order.slice(index*2,index*2+2).sort((a,b)=>a-b);
    match.home=teams[pair[0]-1]??null;match.away=teams[pair[1]-1]??null;
    match.home_seed=match.home===null?null:pair[0];match.away_seed=match.away===null?null:pair[1];match.bye=match.away===null;
  });
}
// Unknown slots are not byes: both feeding sources must have resolved first.
export function resolveBracket(matches,initial,teams,results=[],beforeResolve=()=>{}) {
  const byId=new Map(matches.map(match=>[match.match_id,match])),requested=new Map();
  if (!Array.isArray(results)) validationError(['params.results']);
  for (const result of results) {
    if (!isObject(result)||!byId.has(result.match_id)||!validId(result.winner)||requested.has(result.match_id)) validationError(['params.results']);
    requested.set(result.match_id,result.winner);
  }
  const seed=new Map(teams.map((team,index)=>[team,index+1]));
  const ready=new Map(matches.map(match=>[match.match_id,{home:initial.has(match.match_id),away:initial.has(match.match_id)}]));
  const incoming=new Map(matches.map(match=>[match.match_id,0]));
  for (const match of matches) for (const route of [match.winner_to,match.loser_to]) if (route) incoming.set(route.match_id,incoming.get(route.match_id)+1);
  const queue=matches.filter(match=>incoming.get(match.match_id)===0);
  for (let cursor=0;cursor<queue.length;cursor++) {
    const match=queue[cursor],slots=ready.get(match.match_id);
    beforeResolve(match,byId,slots);
    let resolved=false;
    if (slots.home&&slots.away) {
      if (match.home===null||match.away===null) {match.bye=true;match.winner=match.home??match.away;resolved=true;}
      else if (requested.has(match.match_id)) {
        const winner=requested.get(match.match_id);
        if (![match.home,match.away].includes(winner)) validationError(['params.results']);
        match.winner=winner;match.loser=winner===match.home?match.away:match.home;resolved=true;
      }
    }
    if (requested.has(match.match_id)&&(!resolved||requested.get(match.match_id)!==match.winner)) validationError(['params.results']);
    for (const [kind,route] of [['winner',match.winner_to],['loser',match.loser_to]]) if (route) {
      const next=byId.get(route.match_id);
      if (resolved) {next[route.slot]=match[kind];next[`${route.slot}_seed`]=seed.get(match[kind])??null;ready.get(next.match_id)[route.slot]=true;}
      incoming.set(next.match_id,incoming.get(next.match_id)-1);
      if (incoming.get(next.match_id)===0) queue.push(next);
    }
  }
  return matches;
}
