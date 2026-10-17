import {DomainError,isObject,validId,validationError} from './validation.js';
import {tieBreakOrder} from './baseline.js';
export function validateLeague(body) {
  if(!isObject(body))validationError(['body']);
  const fields=[];
  for(const key of ['league_id','sport_id'])if(!validId(body[key]))fields.push(key);
  const validTeams=Array.isArray(body.teams)&&body.teams.length>=2&&body.teams.length<=40&&body.teams.every(validId)&&new Set(body.teams).size===body.teams.length;
  if(!validTeams)fields.push('teams');
  if(!Array.isArray(body.fixtures))fields.push('fixtures');
  else {
    const seen=new Set();
    body.fixtures.forEach((fixture,i)=>{
      if(!isObject(fixture)||!validId(fixture.match_id)||seen.has(fixture.match_id)||!validId(fixture.home)||!validId(fixture.away)||fixture.home===fixture.away||(validTeams&&(!body.teams.includes(fixture.home)||!body.teams.includes(fixture.away))))fields.push(`fixtures.${i}`);
      if(isObject(fixture))seen.add(fixture.match_id);
    });
  }
  if(body.points!==undefined){if(!isObject(body.points))fields.push('points');else for(const key of ['win','draw','loss'])if(body.points[key]!==undefined&&!Number.isSafeInteger(body.points[key]))fields.push(`points.${key}`);}
  if(body.tie_break_order!==undefined&&(!Array.isArray(body.tie_break_order)||body.tie_break_order.some(key=>!tieBreakOrder.includes(key))||new Set(body.tie_break_order).size!==body.tie_break_order.length))fields.push('tie_break_order');
  if(!isObject(body.qualification)||!Number.isSafeInteger(body.qualification.spots)||body.qualification.spots<1||(validTeams&&body.qualification.spots>body.teams.length))fields.push('qualification.spots');
  if(body.lots_seed!==undefined&&!Number.isSafeInteger(body.lots_seed))fields.push('lots_seed');
  if(fields.length)validationError(fields);
  return {league_id:body.league_id,sport_id:body.sport_id,teams:[...body.teams],fixtures:body.fixtures.map(({match_id,home,away})=>({match_id,home,away})),points:{win:body.points?.win??3,draw:body.points?.draw??1,loss:body.points?.loss??0},qualification:{spots:body.qualification.spots},...(body.tie_break_order===undefined?{}:{tie_break_order:body.tie_break_order}),...(body.lots_seed===undefined?{}:{lots_seed:body.lots_seed})};
}
export async function createLeague(pool,body) {
  const config=validateLeague(body),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    const sport=(await client.query('SELECT config FROM sports WHERE sport_id=$1',[config.sport_id])).rows[0]?.config;
    if(!sport)throw new DomainError(404,'SPORT_NOT_FOUND','Sport does not exist');
    await client.query('SELECT pg_advisory_xact_lock(515,hashtext($1))',[config.league_id]);
    if((await client.query('SELECT 1 FROM leagues WHERE league_id=$1',[config.league_id])).rowCount)throw new DomainError(409,'LEAGUE_EXISTS','League id already exists');
    for(const id of config.fixtures.map(fixture=>fixture.match_id).sort())await client.query('SELECT pg_advisory_xact_lock(514,hashtext($1))',[id]);
    const existing=(await client.query('SELECT match_id FROM matches WHERE match_id=ANY($1::text[])',[config.fixtures.map(fixture=>fixture.match_id)])).rows;
    if(existing.length)throw new DomainError(409,'MATCH_EXISTS','Match id already exists',{match_id:existing[0].match_id});
    if(config.lots_seed===undefined)config.lots_seed=(await client.query("SELECT value FROM app_state WHERE key='seed'")).rows[0]?.value??42;
    const order=config.tie_break_order??sport.tie_break_order;
    config.tie_break_order=[...order.filter(key=>key!=='draw_lots'),'draw_lots'];
    await client.query('INSERT INTO leagues(league_id,config) VALUES ($1,$2)',[config.league_id,config]);
    for(const fixture of config.fixtures)await client.query('INSERT INTO matches(match_id,data) VALUES ($1,$2)',[fixture.match_id,{sport_id:config.sport_id,league_id:config.league_id,home_team_id:fixture.home,away_team_id:fixture.away}]);
    await client.query('COMMIT');
    return {league_id:config.league_id,status:'created',team_count:config.teams.length,fixture_count:config.fixtures.length};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
