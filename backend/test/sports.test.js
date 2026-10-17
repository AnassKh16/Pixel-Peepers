import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { validateSport } from '../src/sports.js';

export const mystery = (model = 'event', overrides = {}) => ({
  sport_id: `mystery-${model}`, name: `Configured ${model}`, scoring_model: model,
  periods: model === 'event' ? {count: 2, duration_minutes: 7} : model === 'innings' ? {innings_per_team: 2, overs_per_innings: 1, balls_per_over: 2, wickets_per_innings: 1} : {best_of: 3},
  scoring_events: model === 'event' ? {pulse: {points: 3}, burst: {points: 2}} : model === 'innings' ? {drift: {runs: 2, legal_ball: false, wicket: false}, counted: {runs: 1, legal_ball: true, wicket: false}, removal: {runs: 0, legal_ball: true, wicket: true}} : {orbit: {rounds: 1}, leap: {rounds: 2}},
  draw_allowed: false, overtime: {policy: 'shootout'}, roster: {min_squad_size: 1, max_squad_size: 9, required_positions: {anchor: 1}}, ...overrides
});

const base = 'http://127.0.0.1:8080';
const post = body => fetch(base+'/audit/v1/sports', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
const defaults = ['h2h_points','h2h_diff','overall_diff','scored','fair_play','draw_lots'];

test('Section 5.6 sport configuration API', {skip: process.env.RUN_INTEGRATION !== '1'}, async t => {
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const reset = () => fetch(base+'/audit/v1/reset',{method:'POST'});
  await reset();
  try {
    await t.test('all four seeded rows use the same validated schema as custom sports', async () => {
      const {rows} = await pool.query('SELECT sport_id,config FROM sports ORDER BY sport_id');
      assert.equal(rows.length,4);
      for (const row of rows) {
        assert.equal(row.sport_id,row.config.sport_id);
        assert.deepEqual(validateSport(row.config),row.config);
      }
    });
    for (const model of ['event','innings','round']) await t.test(`${model}: 201 echoes stored config with full default tie-break order`, async () => {
      const request = mystery(model);
      const response = await post(request);
      assert.equal(response.status,201);
      const body = await response.json();
      assert.deepEqual(body,{sport_id:request.sport_id,status:'created',config:{...request,tie_break_order:defaults}});
      assert.deepEqual((await pool.query('SELECT config FROM sports WHERE sport_id=$1',[request.sport_id])).rows[0].config,body.config);
    });
    const invalid = [
      ['body null',null,'body'], ['body array',[],'body'], ['body number',3,'body'],
      ...['sport_id','name','scoring_model','periods','scoring_events','draw_allowed','overtime','roster'].map(key => { const body=mystery(); delete body[key]; return [`missing ${key}`,body,key]; }),
      ['short id',mystery('event',{sport_id:'a'}),'sport_id'],
      ['long id',mystery('event',{sport_id:'a'.repeat(41)}),'sport_id'],
      ['uppercase id',mystery('event',{sport_id:'Upper'}),'sport_id'],
      ['hostile id',mystery('event',{sport_id:"x'; DROP TABLE sports;--"}),'sport_id'],
      ['empty name',mystery('event',{name:''}),'name'],
      ['long name',mystery('event',{name:'a'.repeat(81)}),'name'],
      ['invalid model',mystery('event',{scoring_model:'unknown'}),'scoring_model'],
      ['array model',mystery('event',{scoring_model:['event']}),'scoring_model'],
      ['object model',mystery('event',{scoring_model:{toString:null}}),'scoring_model'],
      ['event period zero',mystery('event',{periods:{count:0,duration_minutes:1}}),'periods.count'],
      ['event duration zero',mystery('event',{periods:{count:1,duration_minutes:0}}),'periods.duration_minutes'],
      ['fractional event period',mystery('event',{periods:{count:1.2,duration_minutes:1}}),'periods.count'],
      ...['innings_per_team','overs_per_innings','balls_per_over','wickets_per_innings'].map(key => {const body=mystery('innings');body.periods[key]=0;return [`innings ${key}`,body,`periods.${key}`];}),
      ['even series',mystery('round',{periods:{best_of:2}}),'periods.best_of'],
      ['zero series',mystery('round',{periods:{best_of:0}}),'periods.best_of'],
      ['fractional series',mystery('round',{periods:{best_of:1.5}}),'periods.best_of'],
      ['empty events',mystery('event',{scoring_events:{}}),'scoring_events'],
      ['array events',mystery('event',{scoring_events:[]}),'scoring_events'],
      ['bad event name',mystery('event',{scoring_events:{'Bad-Key':{points:1}}}),'scoring_events.Bad-Key'],
      ['long event name',mystery('event',{scoring_events:{['a'.repeat(41)]:{points:1}}}),`scoring_events.${'a'.repeat(41)}`],
      ['null event definition',mystery('event',{scoring_events:{pulse:null}}),'scoring_events.pulse'],
      ['zero points',mystery('event',{scoring_events:{pulse:{points:0}}}),'scoring_events.pulse.points'],
      ['fractional points',mystery('event',{scoring_events:{pulse:{points:1.5}}}),'scoring_events.pulse.points'],
      ['negative runs',mystery('innings',{scoring_events:{pulse:{runs:-1,legal_ball:true,wicket:false}}}),'scoring_events.pulse.runs'],
      ['nonboolean legal flag',mystery('innings',{scoring_events:{pulse:{runs:0,legal_ball:1,wicket:false}}}),'scoring_events.pulse.legal_ball'],
      ['missing wicket flag',mystery('innings',{scoring_events:{pulse:{runs:0,legal_ball:true}}}),'scoring_events.pulse.wicket'],
      ['zero rounds',mystery('round',{scoring_events:{pulse:{rounds:0}}}),'scoring_events.pulse.rounds'],
      ['nonboolean draw',mystery('event',{draw_allowed:1}),'draw_allowed'],
      ['unknown overtime',mystery('event',{overtime:{policy:'invalid'}}),'overtime.policy'],
      ['negative overtime duration',mystery('event',{overtime:{policy:'none',duration_minutes:-1}}),'overtime.duration_minutes'],
      ['duplicate tie-break',mystery('event',{tie_break_order:['scored','scored']}),'tie_break_order'],
      ['unknown tie-break',mystery('event',{tie_break_order:['unknown']}),'tie_break_order'],
      ['nonarray tie-break',mystery('event',{tie_break_order:'scored'}),'tie_break_order'],
      ['zero min roster',mystery('event',{roster:{min_squad_size:0,max_squad_size:2,required_positions:{}}}),'roster.min_squad_size'],
      ['fractional max roster',mystery('event',{roster:{min_squad_size:1,max_squad_size:2.5,required_positions:{}}}),'roster.max_squad_size'],
      ['inverted roster',mystery('event',{roster:{min_squad_size:3,max_squad_size:2,required_positions:{}}}),'roster.max_squad_size'],
      ['object min roster',mystery('event',{roster:{min_squad_size:{toString:null},max_squad_size:2,required_positions:{}}}),'roster.min_squad_size'],
      ['nonobject positions',mystery('event',{roster:{min_squad_size:1,max_squad_size:2,required_positions:[]}}),'roster.required_positions'],
      ['negative position minimum',mystery('event',{roster:{min_squad_size:1,max_squad_size:2,required_positions:{anchor:-1}}}),'roster.required_positions.anchor']
    ];
    for (const [name,body,field] of invalid) await t.test(`400 validation: ${name}`, async () => {
      const response = await post(body);
      assert.equal(response.status,400);
      const result = await response.json();
      assert.equal(result.error.code,'VALIDATION_ERROR');
      assert.ok(result.error.details.fields.includes(field),JSON.stringify(result));
    });
    await t.test('duplicates return SPORT_EXISTS; invalid duplicate still returns validation first', async () => {
      const response = await post(mystery());
      assert.equal(response.status,409);
      assert.equal((await response.json()).error.code,'SPORT_EXISTS');
      assert.equal((await post(mystery('event',{name:2}))).status,400);
    });
    await t.test('unknown fields ignored and draw_lots always last, including when omitted', async () => {
      const request = mystery('event',{sport_id:'normalized',tie_break_order:['draw_lots','scored'],ignored:1,periods:{count:1,duration_minutes:1,ignored:1},scoring_events:{custom:{points:1,ignored:true}}});
      const response = await post(request);
      assert.equal(response.status,201);
      const {config} = await response.json();
      assert.deepEqual(config.tie_break_order,['scored','draw_lots']);
      assert.deepEqual(config.periods,{count:1,duration_minutes:1});
      assert.deepEqual(config.scoring_events,{custom:{points:1}});
      assert.equal(config.ignored,undefined);
      const omitted = await (await post(mystery('round',{sport_id:'minimal',periods:{best_of:1},tie_break_order:[],overtime:{policy:'none',duration_minutes:0}}))).json();
      assert.deepEqual(omitted.config.tie_break_order,['draw_lots']);
    });
    await t.test('concurrent duplicate creation yields one 201 and seven SPORT_EXISTS', async () => {
      const responses = await Promise.all(Array.from({length:8},()=>post(mystery('event',{sport_id:'concurrent-sport'}))));
      assert.equal(responses.filter(response=>response.status===201).length,1);
      assert.equal(responses.filter(response=>response.status===409).length,7);
    });
  } finally { await reset(); await pool.end(); }
});
