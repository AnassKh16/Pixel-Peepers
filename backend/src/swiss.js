import { DomainError,isObject,validationError } from './validation.js';
import { minimumPairing } from './matching.js';
export function swiss(teams,params) {
  const n=teams.length,total=params.total_rounds===undefined?Math.ceil(Math.log2(n)):params.total_rounds,round=params.round===undefined?1:params.round,history=params.history===undefined?[]:params.history;
  if(!Number.isSafeInteger(total)||total<1||total>n-1)validationError(['params.total_rounds']);
  if(!Number.isSafeInteger(round)||round<1||round>total)validationError(['params.round']);
  if(!Array.isArray(history)||history.length!==round-1)validationError(['params.history']);
  const index=new Map(teams.map((team,i)=>[team,i])),scores=Array(n).fill(0),opponents=teams.map(()=>[]),byes=new Set(),rounds=new Set(),allowed=teams.map((_,i)=>teams.map((_,j)=>i!==j));
  for(const item of history) {
    if(!isObject(item)||!Number.isSafeInteger(item.round)||item.round<1||item.round>=round||rounds.has(item.round)||!Array.isArray(item.matches)||item.matches.length!==Math.floor(n/2))validationError(['params.history']);
    rounds.add(item.round);const seen=new Set();
    if(n%2) {
      if(!index.has(item.bye))validationError(['params.history.bye']);
      const bye=index.get(item.bye);seen.add(bye);byes.add(bye);scores[bye]+=2;
    } else if(item.bye!==undefined&&item.bye!==null)validationError(['params.history.bye']);
    for(const match of item.matches) {
      if(!isObject(match)||!index.has(match.home)||!index.has(match.away)||match.home===match.away||!['home','away','draw'].includes(match.result))validationError(['params.history.matches']);
      const a=index.get(match.home),b=index.get(match.away);
      if(seen.has(a)||seen.has(b))validationError(['params.history.matches']);
      seen.add(a);seen.add(b);opponents[a].push(b);opponents[b].push(a);allowed[a][b]=allowed[b][a]=false;
      scores[a]+=match.result==='home'?2:match.result==='draw'?1:0;scores[b]+=match.result==='away'?2:match.result==='draw'?1:0;
    }
    if(seen.size!==n)validationError(['params.history']);
  }
  const buchholz=opponents.map(list=>list.reduce((sum,opponent)=>sum+scores[opponent],0));
  const standings=teams.map((team_id,i)=>({team_id,score:scores[i]/2,buchholz:buchholz[i]/2,seed:i})).sort((a,b)=>b.score-a.score||b.buchholz-a.buchholz||a.seed-b.seed).map(({seed,...entry},i)=>({rank:i+1,...entry}));
  let pairs,bye=null;
  if(round===1) {
    const m=Math.floor(n/2);pairs=Array.from({length:m},(_,i)=>[i,i+m]);if(n%2)bye=n-1;
  } else {
    const candidates=n%2?teams.map((_,i)=>i).filter(i=>!byes.has(i)).sort((a,b)=>scores[a]-scores[b]||b-a):[null];
    for(const candidate of candidates) {
      pairs=minimumPairing(teams.map((_,i)=>i).filter(i=>i!==candidate),allowed,scores);
      if(pairs!==null){bye=candidate;break;}
    }
    if(!pairs)throw new DomainError(409,'NO_VALID_PAIRING','No complete rematch-free pairing exists',{round});
    pairs=pairs.map(([a,b])=>a<b?[a,b]:[b,a]).sort((a,b)=>a[0]-b[0]);
  }
  return {format:'swiss',round,total_rounds:total,pairings:pairs.map(([a,b],i)=>({match_id:`SW-R${round}-M${i+1}`,home:teams[a],away:teams[b]})),bye:bye===null?null:teams[bye],standings};
}
