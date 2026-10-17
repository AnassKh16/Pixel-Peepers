import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateFixtures as generate} from '../src/fixtures.js';
import {minimumPairing} from '../src/matching.js';
const teams=n=>Array.from({length:n},(_,i)=>`t${i+1}`);
const key=(a,b)=>[a,b].sort().join('|');
function reference(teams,history) {
  const score=new Map(teams.map(team=>[team,0])),past=new Set(),byes=new Set(),opponents=new Map(teams.map(team=>[team,[]]));
  for(const round of history) {
    if(round.bye){score.set(round.bye,score.get(round.bye)+1);byes.add(round.bye);}
    for(const match of round.matches){past.add(key(match.home,match.away));opponents.get(match.home).push(match.away);opponents.get(match.away).push(match.home);score.set(match.home,score.get(match.home)+(match.result==='home'?1:match.result==='draw'?0.5:0));score.set(match.away,score.get(match.away)+(match.result==='away'?1:match.result==='draw'?0.5:0));}
  }
  function exhaustive(list){if(!list.length)return 0;let best=Infinity;for(let i=1;i<list.length;i++)if(!past.has(key(list[0],list[i])))best=Math.min(best,Math.abs(score.get(list[0])-score.get(list[i]))+exhaustive(list.filter((_,j)=>j!==0&&j!==i)));return best;}
  const candidates=teams.length%2?teams.filter(team=>!byes.has(team)).sort((a,b)=>score.get(a)-score.get(b)||teams.indexOf(b)-teams.indexOf(a)):[null];
  let bye,cost=Infinity;
  for(const candidate of candidates){cost=exhaustive(teams.filter(team=>team!==candidate));if(Number.isFinite(cost)){bye=candidate;break;}}
  const standings=teams.map((team_id,i)=>({team_id,score:score.get(team_id),buchholz:opponents.get(team_id).reduce((sum,opponent)=>sum+score.get(opponent),0),i})).sort((a,b)=>b.score-a.score||b.buchholz-a.buchholz||a.i-b.i).map(({i,...row},index)=>({rank:index+1,...row}));
  return {score,past,bye,cost,standings};
}
for(let n=2;n<=12;n++)test(`swiss n=${n}: exact first round and exhaustive optimality, byes and standings in later rounds`,()=>{
  for(let pattern=0;pattern<3;pattern++) {
    const field=teams(n),history=[],total_rounds=Math.min(n-1,5);
    for(let round=1;round<=total_rounds;round++) {
      const ref=reference(field,history),input={format:'swiss',teams:field,params:{round,total_rounds,history}};
      if(!Number.isFinite(ref.cost)){assert.throws(()=>generate(input),error=>error.code==='NO_VALID_PAIRING'&&error.details.round===round);break;}
      const out=generate(input),seen=out.pairings.flatMap(match=>[match.home,match.away]);if(out.bye!==null)seen.push(out.bye);
      assert.deepEqual([...seen].sort(),[...field].sort());assert.deepEqual(out.standings,ref.standings);
      if(round===1){const m=Math.floor(n/2);assert.deepEqual(out.pairings.map(match=>[match.home,match.away]),Array.from({length:m},(_,i)=>[field[i],field[i+m]]));assert.equal(out.bye,n%2?field.at(-1):null);}
      else {assert.equal(out.bye,ref.bye);assert.equal(out.pairings.reduce((sum,match)=>sum+Math.abs(ref.score.get(match.home)-ref.score.get(match.away)),0),ref.cost);}
      for(const [i,match] of out.pairings.entries()){assert.equal(match.match_id,`SW-R${round}-M${i+1}`);assert.ok(!ref.past.has(key(match.home,match.away)));}
      history.push({round,bye:out.bye,matches:out.pairings.map((match,i)=>({home:match.home,away:match.away,result:['home','away','draw'][(i+round+pattern)%3]}))});
    }
  }
});
test('Swiss exact five-team history example and Buchholz',()=>{
  const history=[{round:1,bye:'t5',matches:[{home:'t1',away:'t3',result:'home'},{home:'t2',away:'t4',result:'draw'}]}];
  const out=generate({format:'swiss',teams:teams(5),params:{total_rounds:3,round:2,history}});
  assert.deepEqual(out.standings,[{rank:1,team_id:'t1',score:1,buchholz:0},{rank:2,team_id:'t5',score:1,buchholz:0},{rank:3,team_id:'t2',score:0.5,buchholz:0.5},{rank:4,team_id:'t4',score:0.5,buchholz:0.5},{rank:5,team_id:'t3',score:0,buchholz:1}]);
  assert.equal(out.bye,'t3');
});
test('Swiss NO_VALID_PAIRING: legal history leaves two odd disconnected triangles',()=>{
  const field=teams(6),history=Array.from({length:3},(_,r)=>({round:r+1,bye:null,matches:Array.from({length:3},(_,i)=>({home:field[i],away:field[3+(i+r)%3],result:'home'}))}));
  assert.throws(()=>generate({format:'swiss',teams:field,params:{total_rounds:5,round:4,history}}),error=>error.status===409&&error.code==='NO_VALID_PAIRING'&&error.details.round===4);
});
test('custom matching oracle: arbitrary non-bipartite graphs and scores',()=>{
  let seed=12345;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(const n of [2,4,6,8,10])for(let trial=0;trial<40;trial++) {
    const scores=Array.from({length:n},()=>Math.floor(random()*10)),allowed=Array.from({length:n},()=>Array(n).fill(false));
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)allowed[i][j]=allowed[j][i]=random()<0.55;
    function brute(list){if(!list.length)return 0;let best=Infinity;for(let i=1;i<list.length;i++)if(allowed[list[0]][list[i]])best=Math.min(best,Math.abs(scores[list[0]]-scores[list[i]])+brute(list.filter((_,j)=>j!==0&&j!==i)));return best;}
    const vertices=Array.from({length:n},(_,i)=>i),expected=brute(vertices),result=minimumPairing(vertices,allowed,scores);
    if(!Number.isFinite(expected))assert.equal(result,null);else{assert.ok(result);assert.equal(result.reduce((sum,[a,b])=>sum+Math.abs(scores[a]-scores[b]),0),expected);}
  }
});
test('Swiss 64-team boundary and validation',()=>{
  const first=generate({format:'swiss',teams:teams(64)});assert.equal(first.pairings.length,32);
  const history=[{round:1,bye:null,matches:first.pairings.map((match,i)=>({...match,result:i%2?'draw':'home'}))}];
  const second=generate({format:'swiss',teams:teams(64),params:{round:2,history}});assert.equal(second.pairings.length,32);
  for(const params of [{total_rounds:0},{total_rounds:4},{round:0},{round:2,history:[]},{round:2,history:[{round:2,matches:[]}]},{history:null},{total_rounds:null}])assert.throws(()=>generate({format:'swiss',teams:teams(4),params}),error=>error.status===400);
});
