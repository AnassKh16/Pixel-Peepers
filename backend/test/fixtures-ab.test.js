import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateFixtures as generate} from '../src/fixtures.js';
const teams=n=>Array.from({length:n},(_,i)=>`t${i+1}`);
const pair=(a,b)=>[a,b].sort().join('|');
for(let n=2;n<=12;n++) for(const legs of [1,2]) test(`round_robin n=${n} legs=${legs}: pairs, byes, per-leg balance and ids`,()=>{
  const input={format:'round_robin',teams:teams(n),params:{legs}},snapshot=structuredClone(input),out=generate(input),counts=new Map(),ordered=new Set();
  assert.deepEqual(input,snapshot);
  assert.equal(out.round_count,(n%2?n:n-1)*legs);
  for(let leg=1;leg<=legs;leg++) {
    const balance=new Map(input.teams.map(team=>[team,0])),byes=new Map(input.teams.map(team=>[team,0]));
    for(const round of out.rounds.filter(round=>round.matches[0].leg===leg)) {
      assert.equal(round.matches.length,Math.floor(n/2));assert.equal(round.byes.length,n%2);
      const used=[...round.byes];for(const bye of round.byes) byes.set(bye,byes.get(bye)+1);
      for(const [i,match] of round.matches.entries()) {
        assert.equal(match.match_id,`RR-L${leg}-R${round.round}-M${i+1}`);
        used.push(match.home,match.away);balance.set(match.home,balance.get(match.home)+1);balance.set(match.away,balance.get(match.away)-1);
        counts.set(pair(match.home,match.away),(counts.get(pair(match.home,match.away))??0)+1);ordered.add(`${match.home}|${match.away}`);
      }
      assert.deepEqual([...used].sort(),[...input.teams].sort());
    }
    for(const value of balance.values()) assert.ok(Math.abs(value)<=1);
    for(const value of byes.values()) assert.equal(value,n%2);
  }
  assert.equal(counts.size,n*(n-1)/2);for(const value of counts.values())assert.equal(value,legs);
  if(legs===2)assert.equal(ordered.size,n*(n-1));
  assert.deepEqual(out.summary,{total:n*(n-1)/2*legs,scheduled:n*(n-1)/2*legs,forfeit:0,voided:0});
});
test('round-robin spec withdrawal example and both withdrawn',()=>{
  const out=generate({format:'round_robin',teams:teams(5),params:{legs:1,withdrawals:[{team_id:'t3',after_round:2}],withdrawal_policy:'forfeit_remaining'}});
  for(const round of out.rounds)for(const match of round.matches) {
    const forfeited=[match.home,match.away].includes('t3')&&round.round>2;
    assert.equal(match.status,forfeited?'forfeit':'scheduled');assert.equal(match.awarded_to,forfeited?(match.home==='t3'?match.away:match.home):null);
  }
  const voided=generate({format:'round_robin',teams:teams(5),params:{withdrawals:[{team_id:'t3',after_round:2}],withdrawal_policy:'void_all'}});
  assert.equal(voided.summary.voided,4);assert.equal(voided.summary.total,10);
  const both=generate({format:'round_robin',teams:teams(2),params:{withdrawals:[{team_id:'t1',after_round:1},{team_id:'t2',after_round:1}]}});
  assert.equal(both.summary.voided,1);
});
for(let n=2;n<=12;n++)test(`single_elim n=${n}: exact counts, seeding, byes, routing and complete playthrough`,()=>{
  const input={format:'single_elim',teams:teams(n)},out=generate(input),size=2**Math.ceil(Math.log2(n)),all=out.rounds.flatMap(round=>round.matches),results=[];
  assert.equal(out.bracket_size,size);assert.equal(all.length,size-1);
  assert.equal(out.rounds[0].matches.filter(match=>match.bye).length,size-n);
  for(const match of all) {
    assert.deepEqual(Object.keys(match).sort(),['match_id','bracket','round','index','home','away','home_seed','away_seed','bye','winner','loser','winner_to','loser_to'].sort());
    assert.equal(match.match_id,`R${match.round}M${match.index}`);
    if(match.round<Math.log2(size))assert.deepEqual(match.winner_to,{match_id:`R${match.round+1}M${Math.ceil(match.index/2)}`,slot:match.index%2?'home':'away'});
    else assert.equal(match.winner_to,null);
    if(match.bye){assert.equal(match.away,null);assert.equal(match.winner,match.home);}
  }
  let current=out;
  for(const round of out.rounds)for(const original of round.matches) {
    const match=current.rounds.flatMap(round=>round.matches).find(match=>match.match_id===original.match_id);
    if(!match.bye){assert.ok(match.home&&match.away);results.push({match_id:match.match_id,winner:match.home});current=generate({...input,params:{results}});}
  }
  assert.ok(current.rounds.at(-1).matches[0].winner);
});
test('single-elim exact six-team spec example and result propagation',()=>{
  const out=generate({format:'single_elim',teams:teams(6),params:{results:[{match_id:'R1M2',winner:'t4'}]}});
  assert.deepEqual(out.rounds[0].matches.map(match=>[match.home,match.away,match.bye]),[['t1',null,true],['t4','t5',false],['t2',null,true],['t3','t6',false]]);
  assert.equal(out.rounds[1].matches[0].home,'t1');assert.equal(out.rounds[1].matches[0].away,'t4');
});
test('single-elim third-place routing and out-of-order results',()=>{
  const out=generate({format:'single_elim',teams:teams(4),params:{third_place_match:true,results:[{match_id:'TP',winner:'t4'},{match_id:'R2M1',winner:'t1'},{match_id:'R1M2',winner:'t2'},{match_id:'R1M1',winner:'t1'}]}});
  const tp=out.rounds.at(-1).matches.find(match=>match.match_id==='TP');assert.equal(tp.winner,'t4');assert.equal(tp.bracket,'third_place');
});
test('A/B validation errors',()=>{
  for(const body of [null,{}, {format:'round_robin',teams:['one']},{format:'single_elim',teams:['same','same']},{format:'round_robin',teams:teams(3),params:{legs:3}},{format:'round_robin',teams:teams(3),params:{withdrawals:[{team_id:'missing',after_round:1}]}},{format:'round_robin',teams:teams(3),params:{withdrawals:[{team_id:'t1',after_round:4}]}},{format:'round_robin',teams:teams(3),params:{withdrawals:[{team_id:'t1',after_round:-1}]}},{format:'single_elim',teams:teams(4),params:{results:[{match_id:'bad',winner:'t1'}]}},{format:'single_elim',teams:teams(4),params:{results:[{match_id:'R1M1',winner:'t2'}]}}]) assert.throws(()=>generate(body),error=>error.status===400&&error.code==='VALIDATION_ERROR'&&Array.isArray(error.details.fields));
});
