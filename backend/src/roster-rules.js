import {DomainError} from './validation.js';
const fail=(code,message,status=409)=>{throw new DomainError(status,code,message);};

// Dates are compared as ISO calendar dates, never in the host's local timezone.
export function calendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const time=Date.parse(value);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
export function nextDay(value) {
  return new Date(Date.parse(value)+86400000).toISOString().slice(0,10);
}

// Pure ordered checks: callers must validate the request schema before entering.
// Nothing is changed until every rule has passed; rejected transactions write nothing.
export function checkTransfer(scenario,request) {
  if(!scenario)fail('LEAGUE_NOT_FOUND','Roster league not found',404);
  const player=scenario.players.find(p=>p.player_id===request.player_id);
  if(!player)fail('PLAYER_NOT_FOUND','Player not found',404);
  const from=scenario.squads.find(s=>s.squad_id===request.from_squad_id);
  const to=request.type==='release'?null:scenario.squads.find(s=>s.squad_id===request.to_squad_id);
  if(!from||(request.type!=='release'&&!to))fail('SQUAD_NOT_FOUND','Squad not found',404);
  if(from.tenant_id!==scenario.league.tenant_id||(to&&to.tenant_id!==scenario.league.tenant_id))fail('CROSS_TENANT_TRANSFER','Squads belong to different tenants');
  if(player.squad_id!==from.squad_id)fail('NOT_IN_SQUAD','Player is not in source squad');
  const window=scenario.league.transfer_window;
  if(request.type!=='release'&&window&&(request.effective_date<window.open||request.effective_date>window.close))fail('TRANSFER_WINDOW_CLOSED','Transfer window is closed');
  if(player.registration_type==='loan')fail('PLAYER_ON_LOAN','Player is already on loan');
  if(to&&scenario.players.filter(p=>p.squad_id===to.squad_id).length+1>scenario.league.max_squad_size)fail('SQUAD_FULL','Destination squad is full');
  for(const [position,minimum]of Object.entries(scenario.league.required_positions??{})){
    if(player.position===position&&scenario.players.filter(p=>p.squad_id===from.squad_id&&p.position===position).length-1<minimum)fail('MIN_POSITION_VIOLATION','Source squad would lack a required position');
  }
  return {player,from,to};
}
