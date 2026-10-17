import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateFixtures as generate} from '../src/fixtures.js';
const teams=n=>Array.from({length:n},(_,i)=>`t${i+1}`);
const all=out=>[...out.winners.flatMap(round=>round.matches),...out.losers.flatMap(round=>round.matches),...out.grand_final];
function graph(out) {
  const matches=all(out),map=new Map(matches.map(match=>[match.match_id,match])),incoming=new Map(matches.map(match=>[match.match_id,{home:0,away:0}]));
  for(const match of matches) {
    assert.ok(Object.hasOwn(match,'conditional')&&Object.hasOwn(match,'required'));
    for(const route of [match.winner_to,match.loser_to])if(route){assert.ok(map.has(route.match_id));assert.ok(['home','away'].includes(route.slot));incoming.get(route.match_id)[route.slot]++;}
    if(match.bracket==='winners')assert.ok(match.loser_to);
    if(match.bracket==='losers')assert.equal(match.loser_to,null);
    if(match.match_id!==out.grand_final.at(-1).match_id)assert.ok(match.winner_to);
  }
  for(const match of matches)assert.deepEqual(incoming.get(match.match_id),match.bracket==='winners'&&match.round===1?{home:0,away:0}:{home:1,away:1});
  const visited=new Set(),active=new Set();
  function visit(id){assert.ok(!active.has(id),'routing graph must be acyclic');if(visited.has(id))return;active.add(id);for(const route of [map.get(id).winner_to,map.get(id).loser_to])if(route)visit(route.match_id);active.delete(id);visited.add(id);}
  for(const match of matches)visit(match.match_id);
}
for(let n=3;n<=12;n++)for(const bracket_reset of [false,true])test(`double_elim n=${n} reset=${bracket_reset}: counts, seeds, byes, routing and full playthrough`,()=>{
  const input={format:'double_elim',teams:teams(n),params:{bracket_reset}},out=generate(input),size=out.bracket_size,k=Math.log2(size);
  assert.equal(out.winners.flatMap(round=>round.matches).length,size-1);assert.equal(out.losers.flatMap(round=>round.matches).length,size-2);assert.equal(out.grand_final.length,bracket_reset?2:1);
  assert.equal(out.winners[0].matches.filter(match=>match.bye).length,size-n);
  const single=generate({format:'single_elim',teams:teams(n)});
  assert.deepEqual(out.winners[0].matches.map(match=>[match.home,match.away,match.bye]),single.rounds[0].matches.map(match=>[match.home,match.away,match.bye]));
  for(const round of out.losers)assert.equal(round.matches.length,size/2**(Math.ceil(round.round/2)+1));
  for(const round of out.winners)for(const match of round.matches)assert.ok(match.loser_to.match_id.startsWith(`LR${round.round===1?1:2*round.round-2}M`));
  assert.deepEqual(out.winners.at(-1).matches[0].winner_to,{match_id:'GF1',slot:'home'});
  assert.deepEqual(out.winners.at(-1).matches[0].loser_to,{match_id:`LR${2*(k-1)}M1`,slot:'away'});
  assert.deepEqual(out.losers.at(-1).matches[0].winner_to,{match_id:'GF1',slot:'away'});graph(out);
  for(const losersWinGF1 of [false,true]) {
    const results=[],losses=new Map(input.teams.map(team=>[team,0]));let current=out;
    for(let step=0;step<2*size+2;step++) {
      const pending=all(current).find(match=>!match.bye&&match.winner===null&&match.home!==null&&match.away!==null&&(match.conditional!==true||match.required===true));
      if(!pending)break;
      const winner=pending.match_id==='GF1'&&losersWinGF1?pending.away:pending.home,loser=winner===pending.home?pending.away:pending.home;
      losses.set(loser,losses.get(loser)+1);results.push({match_id:pending.match_id,winner});
      current=generate({...input,params:{bracket_reset,results:[...results].reverse()}});
      for(const source of all(current))for(const [kind,route]of [['winner',source.winner_to],['loser',source.loser_to]])if(route&&source.winner!==null){assert.equal(all(current).find(match=>match.match_id===route.match_id)[route.slot],source[kind]);}
    }
    const first=current.grand_final[0];assert.ok(first.winner);assert.equal(results.length,2*n-2+(bracket_reset&&losersWinGF1?1:0));
    if(bracket_reset){const reset=current.grand_final[1];assert.equal(reset.conditional,true);assert.equal(reset.required,losersWinGF1);assert.deepEqual([reset.home,reset.away].sort(),[first.home,first.away].sort());if(losersWinGF1)assert.ok(reset.winner);else assert.equal(reset.winner,null);const champion=losersWinGF1?reset.winner:first.winner;for(const [team,count]of losses)assert.equal(team===champion?count<=1:count===2,true);}
  }
});
test('double-elim spec eight-team example and conditional reset before GF1 result',()=>{
  const out=generate({format:'double_elim',teams:teams(8),params:{bracket_reset:true,results:[{match_id:'WR1M1',winner:'t1'}]}});
  assert.equal(out.winners[1].matches[0].home,'t1');assert.equal(out.losers[0].matches[0].home,'t8');assert.equal(out.grand_final[1].required,null);
});
test('double-elim boundary validation and 128-team routing',()=>{
  for(const params of [{bracket_reset:1},{results:[{match_id:'unknown',winner:'t1'}]},{results:[{match_id:'GF2',winner:'t1'}],bracket_reset:true},{results:[{match_id:'WR1M1',winner:'t2'}]}])assert.throws(()=>generate({format:'double_elim',teams:teams(4),params}),error=>error.status===400);
  assert.throws(()=>generate({format:'double_elim',teams:teams(2)}),error=>error.status===400);graph(generate({format:'double_elim',teams:teams(128),params:{bracket_reset:true}}));
});
