import {nextDay} from './roster-rules.js';
export const generation=scenario=>scenario.generation??'baseline';
export async function rosterEntries(client,scenario,player) {
  return (await client.query("SELECT data FROM roster_history WHERE league_id=$1 AND data->>'generation'=$2 AND ($3::text IS NULL OR player_id=$3) ORDER BY entry_sequence",[scenario.league.league_id,generation(scenario),player??null])).rows.map(r=>r.data);
}
// A query for a future date must not corrupt subsequent historical reads.
export function projectRoster(scenario,history,asOf) {
  const players=structuredClone(scenario.initial_players??scenario.players),changes=[];
  for(const [index,record]of history.entries()){
    if(record.audit_entry.action==='loan_return')continue;
    changes.push({date:record.audit_entry.effective_date,index:index*2,player_id:record.audit_entry.player_id,after:record.after});
    // The return is effective on its calendar day even before the history endpoint
    // has materialized its one immutable loan_return entry.
    if(record.audit_entry.action==='loan')changes.push({date:nextDay(record.after.loan_end_date),index:index*2+1,player_id:record.audit_entry.player_id,after:{...record.before,squad_id:record.after.parent_squad_id,role:'substitute',parent_squad_id:null,registration_type:'transfer',start_date:nextDay(record.after.loan_end_date),loan_end_date:null}});
  }
  changes.sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index);
  for(const change of changes)if(change.date<=asOf){const p=players.find(p=>p.player_id===change.player_id);if(p)Object.assign(p,change.after);}
  return {...scenario,players};
}
export function registration(player,league_id) {
  if(player.squad_id===null)return null;
  return {player_id:player.player_id,league_id,squad_id:player.squad_id,parent_squad_id:player.parent_squad_id??null,registration_type:player.registration_type,start_date:player.start_date??null,loan_end_date:player.loan_end_date??null,role:player.role};
}
export async function savePlayerClubs(client,scenario) {
  for(const player of scenario.players){
    const club=scenario.squads.find(s=>s.squad_id===player.squad_id)?.club_id;
    if(club)await client.query('UPDATE players SET club_id=$2 WHERE player_id=$1 AND EXISTS(SELECT 1 FROM clubs WHERE club_id=$2)',[player.player_id,club]);
  }
}
