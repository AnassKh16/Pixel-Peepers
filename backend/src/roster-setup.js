import {randomUUID} from 'node:crypto';
import {DomainError,isObject,validId,validationError} from './validation.js';
import {calendarDate} from './roster-rules.js';
const roles=['captain','vice_captain','starter','substitute'];
export function validateScenario(body) {
  if(!isObject(body))validationError(['body']);
  const fields=[],league=body.league;
  if(!isObject(league))fields.push('league');
  else {
    for(const key of ['league_id','tenant_id','sport_id'])if(!validId(league[key]))fields.push(`league.${key}`);
    const window=league.transfer_window;
    if(!isObject(window)||!calendarDate(window.open)||!calendarDate(window.close)||window.open>window.close)fields.push('league.transfer_window');
    if(league.max_squad_size!==undefined&&(!Number.isSafeInteger(league.max_squad_size)||league.max_squad_size<1))fields.push('league.max_squad_size');
    if(league.required_positions!==undefined&&(!isObject(league.required_positions)||Object.values(league.required_positions).some(n=>!Number.isSafeInteger(n)||n<0)))fields.push('league.required_positions');
  }
  const squads=new Set(),players=new Set();
  if(!Array.isArray(body.squads)||!body.squads.length)fields.push('squads');
  else body.squads.forEach((s,i)=>{
    if(!isObject(s)){fields.push(`squads.${i}`);return;}
    for(const key of ['squad_id','club_id','tenant_id'])if(!validId(s[key]))fields.push(`squads.${i}.${key}`);
    if(squads.has(s.squad_id))fields.push(`squads.${i}.squad_id`);squads.add(s.squad_id);
    if(typeof s.name!=='string')fields.push(`squads.${i}.name`);
  });
  if(!Array.isArray(body.players))fields.push('players');
  else body.players.forEach((p,i)=>{
    if(!isObject(p)){fields.push(`players.${i}`);return;}
    if(!validId(p.player_id)||players.has(p.player_id))fields.push(`players.${i}.player_id`);players.add(p.player_id);
    if(!validId(p.squad_id))fields.push(`players.${i}.squad_id`);
    if(typeof p.name!=='string')fields.push(`players.${i}.name`);
    if(typeof p.position!=='string'||!p.position.length)fields.push(`players.${i}.position`);
    if(!roles.includes(p.role))fields.push(`players.${i}.role`);
  });
  if(body.matches_in_progress!==undefined){
    if(!Array.isArray(body.matches_in_progress))fields.push('matches_in_progress');
    else body.matches_in_progress.forEach((m,i)=>{if(!isObject(m)||!validId(m.match_id)||!validId(m.home_squad_id)||!validId(m.away_squad_id)||m.home_squad_id===m.away_squad_id)fields.push(`matches_in_progress.${i}`);});
  }
  if(fields.length)validationError(fields);
  return {league:{league_id:league.league_id,tenant_id:league.tenant_id,sport_id:league.sport_id,transfer_window:{open:league.transfer_window.open,close:league.transfer_window.close},...(league.max_squad_size===undefined?{}:{max_squad_size:league.max_squad_size}),...(league.required_positions===undefined?{}:{required_positions:{...league.required_positions}})},squads:body.squads.map(({squad_id,club_id,tenant_id,name})=>({squad_id,club_id,tenant_id,name})),players:body.players.map(({player_id,name,position,squad_id,role})=>({player_id,name,position,squad_id,role,parent_squad_id:null,registration_type:'registration',start_date:null,loan_end_date:null})),matches_in_progress:(body.matches_in_progress??[]).map(({match_id,home_squad_id,away_squad_id})=>({match_id,home_squad_id,away_squad_id}))};
}
export async function setupRoster(pool,body) {
  const scenario=validateScenario(body),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    const sport=(await client.query('SELECT config FROM sports WHERE sport_id=$1',[scenario.league.sport_id])).rows[0]?.config;
    if(!sport)throw new DomainError(404,'SPORT_NOT_FOUND','Sport not found');
    const ids=new Set(scenario.squads.map(s=>s.squad_id));
    if(scenario.players.some(p=>!ids.has(p.squad_id))||scenario.matches_in_progress.some(m=>!ids.has(m.home_squad_id)||!ids.has(m.away_squad_id)))throw new DomainError(404,'SQUAD_NOT_FOUND','Squad not found');
    scenario.league.max_squad_size??=sport.roster.max_squad_size;
    scenario.league.required_positions??=sport.roster.required_positions;
    scenario.generation=randomUUID();scenario.initial_players=structuredClone(scenario.players);
    await client.query('SELECT pg_advisory_xact_lock(518,hashtext($1))',[scenario.league.league_id]);
    await client.query('SELECT roster_id FROM rosters WHERE roster_id=$1 FOR UPDATE',[scenario.league.league_id]);
    // A fresh generation replaces scenario state without deleting immutable history.
    await client.query('INSERT INTO rosters VALUES ($1,$2) ON CONFLICT(roster_id) DO UPDATE SET data=EXCLUDED.data',[scenario.league.league_id,scenario]);
    await client.query('COMMIT');
    return {league_id:scenario.league.league_id,status:'configured',squad_counts:Object.fromEntries(scenario.squads.map(s=>[s.squad_id,scenario.players.filter(p=>p.squad_id===s.squad_id).length]))};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
