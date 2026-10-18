import {randomUUID} from 'node:crypto';
import {DomainError,isObject,validId,validationError,databaseText} from './validation.js';
import {filterChatMessage} from './chat-filter.js';

export function chatRoom(body) {
  const id=body?.chat_room_id??(typeof body?.session_id==='string'?`chat-${body.session_id}`:null);
  if(!validId(id)||!id.startsWith('chat-'))validationError(['chat_room_id']);
  return id;
}
export async function recentChat(pool,query) {
  const room=chatRoom(query),after=query.after_sequence===undefined?null:Number(query.after_sequence),limit=query.limit===undefined?100:Number(query.limit);
  if(after!==null&&(!Number.isSafeInteger(after)||after<0))validationError(['after_sequence']);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)validationError(['limit']);
  const rows=(await pool.query('SELECT data FROM chat_messages WHERE chat_room_id=$1 AND ($2::bigint IS NULL OR sequence>$2) ORDER BY sequence DESC LIMIT $3',[room,after,limit])).rows;
  return {chat_room_id:room,messages:rows.map(row=>row.data).reverse()};
}
export async function postChat(pool,actor,body,{filter=filterChatMessage}={}) {
  if(!actor)throw new DomainError(403,'GUEST_WRITE_FORBIDDEN','Anonymous guest tokens cannot perform write mutations.',{guest_token:null});
  if(!isObject(body))validationError(['body']);
  const room=chatRoom(body);
  if(!databaseText(body.text)||!body.text.trim().length||body.text.length>4000)validationError(['text']);
  if(body.message_id!==undefined&&!validId(body.message_id))validationError(['message_id']);
  const message_id=body.message_id??randomUUID(),client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('INSERT INTO chat_rooms(chat_room_id,last_sequence) VALUES ($1,0) ON CONFLICT DO NOTHING',[room]);
    const sequence=(await client.query('SELECT last_sequence FROM chat_rooms WHERE chat_room_id=$1 FOR UPDATE',[room])).rows[0].last_sequence+1;
    const previous=(await client.query('SELECT data,request FROM chat_messages WHERE chat_room_id=$1 AND message_id=$2',[room,message_id])).rows[0];
    const request={sender:actor.sub,text:body.text};
    if(previous){
      if(previous.request.sender!==request.sender||previous.request.text!==request.text)throw new DomainError(409,'DUPLICATE_MESSAGE_ID','Message id has already been used');
      await client.query('COMMIT');return {status:200,response:previous.data};
    }
    const filtered=await filter(body.text);
    if(filtered.dropped){await client.query('COMMIT');return {status:200,response:{chat_room_id:room,message_id,dropped:true,reason:filtered.reason}};}
    const response={chat_room_id:room,message_id,sender:actor.sub,text:filtered.text,sequence,flagged:filtered.flagged,reason:filtered.reason,created_at:new Date().toISOString()};
    await client.query('INSERT INTO chat_messages(chat_room_id,message_id,sequence,data,request) VALUES ($1,$2,$3,$4,$5)',[room,message_id,sequence,response,request]);
    await client.query('UPDATE chat_rooms SET last_sequence=$2 WHERE chat_room_id=$1',[room,sequence]);
    await client.query('COMMIT');return {status:201,response};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
