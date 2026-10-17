import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lotsKey,calculateStandings} from '../src/standings.js';
test('Appendix A test vector 2: exact drawing-of-lots hashes and order',()=>{
  assert.equal(lotsKey(42,'lg-1','t1'),'0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
  assert.equal(lotsKey(42,'lg-1','t2'),'e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
  assert.equal(lotsKey(42,'lg-1','t3'),'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
  const league={league_id:'lg-1',sport_id:'custom',teams:['t1','t2','t3'],fixtures:[],points:{win:3,draw:1,loss:0},tie_break_order:[],qualification:{spots:1},lots_seed:42};
  const out=calculateStandings(league,{scoring_model:'event'},[]);
  assert.deepEqual(out.table.map(row=>row.team_id),['t1','t3','t2']);
  assert.deepEqual(out.table.map(row=>row.resolved_by),['draw_lots','draw_lots',null]);
});
test('all qualification places clinch before elimination; zero-over innings stay finite',()=>{
  const out=calculateStandings({league_id:'empty',sport_id:'custom',teams:['a','b'],fixtures:[],points:{win:0,draw:0,loss:-1},tie_break_order:[],qualification:{spots:2},lots_seed:0},{scoring_model:'innings',periods:{balls_per_over:6}},[]);
  assert.ok(out.table.every(row=>row.status==='clinched'&&row.diff===0));
});
