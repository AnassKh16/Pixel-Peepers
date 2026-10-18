// Batch only requests waiting in this event-loop turn. The entry is removed
// BEFORE executing SQL, so a later request always schedules a fresh statement.
// This is not a time cache: no completed or in-flight database snapshot is reused.
const queues=new WeakMap();
export function batchRead(pool,key,read){
  let queue=queues.get(pool);if(!queue){queue=new Map();queues.set(pool,queue);}
  if(queue.has(key))return queue.get(key);
  const result=new Promise((resolve,reject)=>setImmediate(()=>{
    queue.delete(key);
    Promise.resolve().then(read).then(resolve,reject);
  }));
  queue.set(key,result);return result;
}
