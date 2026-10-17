import {canonical} from './signature.js';
import {DomainError,isObject,validId,validationError} from './validation.js';
import {calendarDate,nextDay,checkTransfer} from './roster-rules.js';
import {generation,rosterEntries,projectRoster,registration,savePlayerClubs} from './roster-projection.js';
export {setupRoster} from './roster-setup.js';
const fail=(code,message,status=409)=>{throw new DomainError(status,code,message);};
const today=()=>new Date().toISOString().slice(0,10);
const timestamp=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
// Allocate only after all rejection checks; setup never resets this global sequence.
async function nextAuditId(client) {
  const {rows}=await client.query("SELECT nextval('roster_audit_seq')::text AS value");
  return `au-${rows[0].value.padStart(4,'0')}`;
}
export function validateRoster(body) {
  if(!isObject(body))validationError(['body']);
  const fields=[];
  for(const key of ['request_id','league_id','player_id','from_squad_id','requested_by'])if(!validId(body[key]))fields.push(key);
  if(!['transfer','loan','release'].includes(body.type))fields.push('type');
  if(body.type==='release'){if(body.to_squad_id!==undefined&&body.to_squad_id!==null)fields.push('to_squad_id');}
  else if(!validId(body.to_squad_id)||body.to_squad_id===body.from_squad_id)fields.push('to_squad_id');
  if(!calendarDate(body.effective_date))fields.push('effective_date');
  if(body.loan_end_date!==undefined&&body.loan_end_date!==null&&!calendarDate(body.loan_end_date))fields.push('loan_end_date');
  if(body.type==='loan'&&(!calendarDate(body.loan_end_date)||body.loan_end_date<=body.effective_date))fields.push('loan_end_date');
  if(typeof body.reason!=='string')fields.push('reason');
  if(fields.length)validationError(fields);
  return {request_id:body.request_id,league_id:body.league_id,player_id:body.player_id,type:body.type,from_squad_id:body.from_squad_id,to_squad_id:body.type==='release'?null:body.to_squad_id,effective_date:body.effective_date,loan_end_date:body.type==='loan'?body.loan_end_date:null,reason:body.reason,requested_by:body.requested_by};
}
export async function rosterVersion(pool,league,player) {
  return (await pool.query("SELECT count(*)::int AS version FROM roster_history h JOIN rosters r ON r.roster_id=h.league_id WHERE h.player_id=$1 AND h.data->>'generation'=COALESCE(r.data->>'generation','baseline')",[player])).rows[0].version;
}
export async function changeRoster(pool,body,{baseVersion}={}) {
  const request=validateRoster(body),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('SELECT pg_advisory_xact_lock(516,hashtext($1))',[request.request_id]);
    await client.query('SELECT pg_advisory_xact_lock(518,hashtext($1))',[request.league_id]);
    const scenario=(await client.query('SELECT data FROM rosters WHERE roster_id=$1 FOR UPDATE',[request.league_id])).rows[0]?.data;
    if(!scenario)fail('LEAGUE_NOT_FOUND','Roster league not found',404);
    const prior=(await client.query('SELECT data FROM roster_requests WHERE request_id=$1',[request.request_id])).rows[0]?.data;
    if(prior&&prior.request.league_id!==request.league_id)fail('DUPLICATE_REQUEST_ID','Request id already used');
    if(prior&&prior.generation===generation(scenario)){
      if(canonical(prior.request)!==canonical(request))fail('DUPLICATE_REQUEST_ID','Request id already used');
      await client.query('COMMIT');return {status:200,response:prior.response};
    }
    const history=await rosterEntries(client,scenario),previous_version=await rosterVersion(client,request.league_id,request.player_id);
    if(!scenario.players.some(p=>p.player_id===request.player_id))fail('PLAYER_NOT_FOUND','Player not found',404);
    if(!scenario.squads.some(s=>s.squad_id===request.from_squad_id)||(request.type!=='release'&&!scenario.squads.some(s=>s.squad_id===request.to_squad_id)))fail('SQUAD_NOT_FOUND','Squad not found',404);
    if(baseVersion!==undefined&&baseVersion>previous_version)fail('INVALID_BASE_VERSION','Base version exceeds server version');
    const projected=projectRoster(scenario,history,request.effective_date);
    const {player,from,to}=checkTransfer(projected,request),before=structuredClone(player);
    const blocking=scenario.matches_in_progress.find(m=>[m.home_squad_id,m.away_squad_id].includes(from.squad_id));
    const state=blocking?'deferred_until_match_end':'active';
    // League registration changes now; existing match eligibility remains with the
    // original squad and role for every match already in progress.
    if(blocking){
      scenario.match_eligibility=Object.assign(Object.create(null),scenario.match_eligibility??{});
      for(const match of scenario.matches_in_progress.filter(m=>[m.home_squad_id,m.away_squad_id].includes(from.squad_id))){
        scenario.match_eligibility[match.match_id]=Object.assign(Object.create(null),scenario.match_eligibility[match.match_id]??{});
        scenario.match_eligibility[match.match_id][player.player_id]??={squad_id:from.squad_id,role:player.role};
      }
    }
    Object.assign(player,{squad_id:to?.squad_id??null,role:'substitute',parent_squad_id:request.type==='loan'?from.squad_id:null,registration_type:request.type,start_date:request.effective_date,loan_end_date:request.loan_end_date});
    const audit_entry={audit_id:await nextAuditId(client),action:request.type,player_id:request.player_id,league_id:request.league_id,from_squad_id:from.squad_id,to_squad_id:to?.squad_id??null,effective_date:request.effective_date,state,who:request.requested_by,when:timestamp(),why:request.reason};
    const response={request_id:request.request_id,status:'accepted',state,blocking_match_id:blocking?.match_id??null,registration:registration(player,request.league_id),audit_entry};
    const record={generation:generation(scenario),audit_entry,request,before,after:structuredClone(player)};
    await client.query('INSERT INTO roster_history(audit_id,player_id,league_id,data) VALUES ($1,$2,$3,$4)',[audit_entry.audit_id,request.player_id,request.league_id,record]);
    scenario.initial_players??=structuredClone(scenario.players);
    scenario.players=projectRoster(scenario,[...history,record],today()).players;
    await client.query('UPDATE rosters SET data=$2 WHERE roster_id=$1',[request.league_id,scenario]);await savePlayerClubs(client,scenario);
    await client.query('INSERT INTO roster_requests VALUES ($1,$2) ON CONFLICT(request_id) DO UPDATE SET data=EXCLUDED.data',[request.request_id,{generation:generation(scenario),request,response}]);
    await client.query('COMMIT');return {status:201,response,previous_version};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export const transferRoster=changeRoster;
export async function rosterHistory(pool,playerId,asOf=today()) {
  if(!calendarDate(asOf))validationError(['as_of']);
  if(!validId(playerId))fail('PLAYER_NOT_FOUND','Player not found',404);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    const row=(await client.query("SELECT roster_id FROM rosters WHERE data->'players' @> $1::jsonb ORDER BY roster_id LIMIT 1",[JSON.stringify([{player_id:playerId}])])).rows[0];
    if(!row)fail('PLAYER_NOT_FOUND','Player not found',404);
    await client.query('SELECT pg_advisory_xact_lock(518,hashtext($1))',[row.roster_id]);
    const scenario=(await client.query('SELECT data FROM rosters WHERE roster_id=$1 FOR UPDATE',[row.roster_id])).rows[0].data;
    if(!scenario.players.some(p=>p.player_id===playerId))fail('PLAYER_NOT_FOUND','Player not found',404);
    let history=await rosterEntries(client,scenario,playerId),inserted=false;
    for(const loan of history.filter(h=>h.audit_entry.action==='loan'&&nextDay(h.after.loan_end_date)<=asOf)){
      if(history.some(h=>h.source_loan_id===loan.audit_entry.audit_id))continue;
      const effective_date=nextDay(loan.after.loan_end_date),after={...loan.before,squad_id:loan.after.parent_squad_id,role:'substitute',parent_squad_id:null,registration_type:'transfer',start_date:effective_date,loan_end_date:null};
      const audit_entry={audit_id:await nextAuditId(client),action:'loan_return',player_id:playerId,league_id:row.roster_id,from_squad_id:loan.after.squad_id,to_squad_id:loan.after.parent_squad_id,effective_date,state:'active',who:'system',when:timestamp(),why:'Loan period ended'};
      const record={generation:generation(scenario),audit_entry,before:loan.after,after,source_loan_id:loan.audit_entry.audit_id};
      await client.query('INSERT INTO roster_history(audit_id,player_id,league_id,data) VALUES ($1,$2,$3,$4)',[audit_entry.audit_id,playerId,row.roster_id,record]);history.push(record);inserted=true;
    }
    const all=await rosterEntries(client,scenario),player=projectRoster(scenario,all,asOf).players.find(p=>p.player_id===playerId);
    if(inserted){const current=projectRoster(scenario,all,today());await client.query('UPDATE rosters SET data=$2 WHERE roster_id=$1',[row.roster_id,current]);await savePlayerClubs(client,current);}
    await client.query('COMMIT');
    return {player_id:playerId,as_of:asOf,league_id:row.roster_id,current_squad_id:player.squad_id,parent_squad_id:player.parent_squad_id??null,history:history.map(h=>h.audit_entry)};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}


