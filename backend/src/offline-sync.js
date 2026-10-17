import {appendEvent,getScore,validateEvent} from './scoring.js';
import {changeRoster,rosterVersion,validateRoster} from './roster.js';
import {DomainError,isObject,validId,validationError} from './validation.js';
export function validateSync(body,{legacy=false}={}) {
  if(!isObject(body))validationError(['body']);
  const fields=[];
  if(!validId(body.device_id))fields.push('device_id');
  if(!Array.isArray(body.actions)||body.actions.length<1||body.actions.length>100)fields.push('actions');
  else {const ids=new Set();body.actions.forEach((a,i)=>{
    if(!isObject(a)){fields.push(`actions.${i}`);return;}
    if(!validId(a.action_id)||ids.has(a.action_id))fields.push(`actions.${i}.action_id`);ids.add(a.action_id);
    if(!['score_event','roster_transfer',...(legacy?['roster_action']:[])].includes(a.type))fields.push(`actions.${i}.type`);
    if(typeof a.queued_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(a.queued_at)||!Number.isFinite(Date.parse(a.queued_at))||new Date(a.queued_at).toISOString().replace('.000Z','Z')!==a.queued_at)fields.push(`actions.${i}.queued_at`);
    if(!Number.isSafeInteger(a.base_version)||a.base_version<0)fields.push(`actions.${i}.base_version`);
    if(!isObject(a.payload))fields.push(`actions.${i}.payload`);
  });}
  if(fields.length)validationError(fields);
  return body;
}
export async function syncActions(pool,sign,actor,body,{legacy=false}={}) {
  const device=actor?`${actor.sub}:${body.device_id}`:body.device_id,results=new Map(),processed_order=[];
  const version=async(action,db)=>{
    try{return action.type==='score_event'?(await getScore(db,typeof action.payload.match_id==='string'?action.payload.match_id:'')).version:await rosterVersion(db,typeof action.payload.league_id==='string'?action.payload.league_id:'',typeof action.payload.player_id==='string'?action.payload.player_id:'');}catch(error){if(error instanceof DomainError)return 0;throw error;}
  };
  for(const action of [...body.actions].sort((a,b)=>Date.parse(a.queued_at)-Date.parse(b.queued_at))){
    const client=await pool.connect();
    try {
      // Session locks span domain commits. Domain services reuse this connection
      // instead of exhausting the pool when many devices synchronize at once.
      const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
      await client.query('SELECT pg_advisory_lock_shared(5505)');
      await client.query('SELECT pg_advisory_lock(517,hashtext($1))',[`${device}|${action.action_id}`]);
      const prior=(await client.query('SELECT data FROM offline_sync WHERE device_id=$1 AND action_id=$2',[device,action.action_id])).rows[0]?.data;
      const result={action_id:action.action_id,status:'duplicate',resolution:'skipped_duplicate',error_code:null,processed_order:processed_order.length+1,server_version:0,signature:null};
      let details=null;
      if(!prior){
        try {
          const request=action.type==='score_event'?validateEvent(action.payload):validateRoster({...action.payload,...(actor?{requested_by:actor.sub}:{})});
          const applied=action.type==='score_event'?await appendEvent(db,sign,request,{baseVersion:action.base_version}):await changeRoster(db,request,{baseVersion:action.base_version});
          if(applied.status!==200){result.status='applied';result.resolution=applied.previous_version===action.base_version?'appended':'rebased_append';result.signature=action.type==='score_event'?applied.response.signature:null;}
        }catch(error){
          if(!(error instanceof DomainError))throw error;
          result.status='rejected';result.resolution='server_wins';result.error_code=error.code;details={code:error.code,message:error.message,details:error.details};
        }
      }
      result.server_version=await version(prior?.action??action,db);
      if(!prior)await client.query('INSERT INTO offline_sync VALUES ($1,$2,$3)',[device,action.action_id,{action,result}]);
      results.set(action.action_id,{result,details});processed_order.push(action.action_id);
    }finally{try{await client.query('SELECT pg_advisory_unlock_all()');}finally{client.release();}}
  }
  const ordered=body.actions.map(a=>results.get(a.action_id));
  if(legacy)return {device_id:body.device_id,processed_order,results:ordered.map(({result:r,details})=>({action_id:r.action_id,status:r.status==='duplicate'?'skipped_duplicate':r.status,resolution:r.status==='applied'?r.resolution:null,error:details,server_version:r.server_version,signature:r.signature}))};
  return {device_id:body.device_id,results:ordered.map(r=>r.result),summary:Object.fromEntries(['applied','rejected','duplicate'].map(status=>[status,ordered.filter(({result})=>result.status===status).length]))};
}
