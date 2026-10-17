import {appendEvent,getScore,validateEvent} from './scoring.js';
import {changeRoster,rosterVersion,validateRoster} from './roster.js';
import {DomainError,isObject,validId,validationError} from './validation.js';
export function validateSync(body) {
  if(!isObject(body))validationError(['body']);
  const fields=[];
  if(!validId(body.device_id))fields.push('device_id');
  if(!Array.isArray(body.actions)||body.actions.length<1||body.actions.length>100)fields.push('actions');
  else {const ids=new Set();body.actions.forEach((a,i)=>{
    if(!isObject(a)){fields.push(`actions.${i}`);return;}
    if(!validId(a.action_id)||ids.has(a.action_id))fields.push(`actions.${i}.action_id`);ids.add(a.action_id);
    if(!['score_event','roster_action'].includes(a.type))fields.push(`actions.${i}.type`);
    if(typeof a.queued_at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(a.queued_at)||!Number.isFinite(Date.parse(a.queued_at)))fields.push(`actions.${i}.queued_at`);
    if(!Number.isSafeInteger(a.base_version)||a.base_version<0)fields.push(`actions.${i}.base_version`);
    if(!isObject(a.payload))fields.push(`actions.${i}.payload`);
  });}
  if(fields.length)validationError(fields);
  return body;
}
export async function syncActions(pool,sign,actor,body) {
  const device=`${actor.sub}:${body.device_id}`,results=new Map(),processed_order=[];
  const version=async (action,db=pool)=>{
    try{return action.type==='score_event'?(await getScore(db,action.payload.match_id)).version:await rosterVersion(db,action.payload.league_id,action.payload.player_id);}catch(error){if(error instanceof DomainError)return 0;throw error;}
  };
  for(const action of [...body.actions].sort((a,b)=>Date.parse(a.queued_at)-Date.parse(b.queued_at))){
    const client=await pool.connect();
    try{
      // Session locks survive commits inside the shared domain services.
      // One connection per action avoids nested pool acquisition under a burst.
      const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
      await client.query('SELECT pg_advisory_lock_shared(5505)');
      await client.query('SELECT pg_advisory_lock(517,hashtext($1))',[`${device}|${action.action_id}`]);
      const prior=(await client.query('SELECT data FROM offline_sync WHERE device_id=$1 AND action_id=$2',[device,action.action_id])).rows[0]?.data;
      let result;
      if(prior)result={action_id:action.action_id,status:'skipped_duplicate',resolution:null,error:null,server_version:await version(action,db),signature:null};
      else {
        try {
          const applied=action.type==='score_event'?await appendEvent(db,sign,validateEvent(action.payload),{baseVersion:action.base_version}):await changeRoster(db,validateRoster({...action.payload,requested_by:actor.sub}),{baseVersion:action.base_version});
          result={action_id:action.action_id,status:applied.status===200?'skipped_duplicate':'applied',resolution:applied.status===200?null:applied.previous_version===action.base_version?'appended':'rebased_append',error:null,server_version:await version(action,db),signature:applied.status===200?null:applied.response.signature??null};
        }catch(error){if(!(error instanceof DomainError))throw error;result={action_id:action.action_id,status:'rejected',resolution:null,error:{code:error.code,message:error.message,details:error.details},server_version:await version(action,db),signature:null};}
        await client.query('INSERT INTO offline_sync VALUES ($1,$2,$3)',[device,action.action_id,{action,result}]);
      }
      results.set(action.action_id,result);processed_order.push(action.action_id);
    }finally{try{await client.query('SELECT pg_advisory_unlock_all()');}finally{client.release();}}
  }
  return {device_id:body.device_id,processed_order,results:body.actions.map(a=>results.get(a.action_id))};
}
