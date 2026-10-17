import {randomUUID} from 'node:crypto';
import {canonical} from './signature.js';
import {DomainError,isObject,validId,validationError} from './validation.js';
const fail=(code,message,status=409)=>{throw new DomainError(status,code,message);};
export function validateRoster(body) {
  if(!isObject(body))validationError(['payload']);
  const fields=[];
  for(const key of ['request_id','league_id','player_id','from_squad_id'])if(!validId(body[key]))fields.push(key);
  if(!['transfer','loan','release'].includes(body.type))fields.push('type');
  if(body.type!=='release'&&(!validId(body.to_squad_id)||body.to_squad_id===body.from_squad_id))fields.push('to_squad_id');
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!date(body.effective_date))fields.push('effective_date');
  if(body.type==='loan'&&(!date(body.loan_end_date)||body.loan_end_date<=body.effective_date))fields.push('loan_end_date');
  if(body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.length>1000))fields.push('reason');
  if(fields.length)validationError(fields);
  return {request_id:body.request_id,league_id:body.league_id,player_id:body.player_id,type:body.type,from_squad_id:body.from_squad_id,to_squad_id:body.type==='release'?null:body.to_squad_id,effective_date:body.effective_date,loan_end_date:body.type==='loan'?body.loan_end_date:null,reason:body.reason??'',requested_by:body.requested_by};
}
export async function rosterVersion(pool,league,player) {
  return (await pool.query('SELECT count(*)::int AS version FROM roster_history WHERE league_id=$1 AND player_id=$2',[league,player])).rows[0].version;
}
export async function changeRoster(pool,body,{baseVersion}={}) {
  const request=validateRoster(body),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('SELECT pg_advisory_xact_lock(516,hashtext($1))',[request.request_id]);
    const previous=(await client.query('SELECT data FROM roster_requests WHERE request_id=$1',[request.request_id])).rows[0]?.data;
    if(previous){if(canonical(previous.request)!==canonical(request))fail('DUPLICATE_REQUEST_ID','Request id already used');await client.query('COMMIT');return {status:200,response:previous.response};}
    const scenario=(await client.query('SELECT data FROM rosters WHERE roster_id=$1 FOR UPDATE',[request.league_id])).rows[0]?.data;
    if(!scenario)fail('LEAGUE_NOT_FOUND','Roster league not found',404);
    const previous_version=await rosterVersion(client,request.league_id,request.player_id);
    if(baseVersion!==undefined&&baseVersion>previous_version)fail('INVALID_BASE_VERSION','Base version exceeds server version');
    const from=scenario.squads.find(s=>s.squad_id===request.from_squad_id),to=scenario.squads.find(s=>s.squad_id===request.to_squad_id);
    const player=scenario.players.find(p=>p.player_id===request.player_id);
    if(!from||(request.type!=='release'&&!to))fail('SQUAD_NOT_FOUND','Squad not found',404);
    if(!player)fail('PLAYER_NOT_FOUND','Player not found',404);
    if(to&&to.tenant_id!==from.tenant_id)fail('CROSS_TENANT_TRANSFER','Squads belong to different tenants');
    if(player.squad_id!==from.squad_id)fail('NOT_IN_SQUAD','Player is not in source squad');
    if(request.type!=='release'){
      const window=scenario.league.transfer_window;
      if(window&&(request.effective_date<window.open||request.effective_date>window.close))fail('TRANSFER_WINDOW_CLOSED','Transfer window is closed');
      if(player.registration_type==='loan')fail('PLAYER_ON_LOAN','Player is already on loan');
      if(scenario.players.filter(p=>p.squad_id===to.squad_id).length>=scenario.league.max_squad_size)fail('SQUAD_FULL','Destination squad is full');
    }
    for(const [position,minimum]of Object.entries(scenario.league.required_positions??{}))if(player.position===position&&scenario.players.filter(p=>p.squad_id===from.squad_id&&p.position===position).length-1<minimum)fail('MIN_POSITION_VIOLATION','Source squad would lack a required position');
    player.squad_id=to?.squad_id??null;player.parent_squad_id=request.type==='loan'?from.squad_id:null;player.registration_type=request.type==='release'?'released':request.type==='loan'?'loan':'registration';player.start_date=request.effective_date;player.loan_end_date=request.loan_end_date;
    if(to)await client.query('UPDATE players SET club_id=$2 WHERE player_id=$1',[request.player_id,to.club_id]);
    await client.query('UPDATE rosters SET data=$2 WHERE roster_id=$1',[request.league_id,scenario]);
    const response={request_id:request.request_id,audit_id:`au-${randomUUID()}`,player_id:request.player_id,league_id:request.league_id,type:request.type,from_squad_id:request.from_squad_id,to_squad_id:request.to_squad_id,effective_date:request.effective_date,loan_end_date:request.loan_end_date,status:'active',version:previous_version+1};
    await client.query('INSERT INTO roster_history VALUES ($1,$2,$3,$4)',[response.audit_id,request.player_id,request.league_id,{request,response}]);
    await client.query('INSERT INTO roster_requests VALUES ($1,$2)',[request.request_id,{request,response}]);
    await client.query('COMMIT');return {status:201,response,previous_version};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
