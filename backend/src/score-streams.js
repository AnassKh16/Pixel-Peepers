import {WebSocketServer,WebSocket} from 'ws';
import {publicActor,publicMatch} from './public-data.js';
import {validId,DomainError} from './validation.js';

const envelope=score=>({type:'score',...score,data:score});
export class ScoreStreams {
  constructor(pool,tokens){this.pool=pool;this.tokens=tokens;this.listeners=new Map();this.client=null;this.starting=null;this.closed=false;this.responses=new Set();}
  async start(){
    if(this.closed)throw new DomainError(503,'NOT_READY','Score subscriptions are closing');
    if(this.client)return;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const client=await this.pool.connect();
      try{
        client.on('notification',message=>{
          if(message.channel!=='nascon_scores')return;
          let update;try{update=JSON.parse(message.payload);}catch{return;}
          if(update.reset){
            for(const [id,sinks]of this.listeners){for(const sink of sinks){sink.last=null;sink.version=-1;}publicMatch(this.pool,id).then(score=>this.emit(score)).catch(()=>{});}
          }else if(update.refresh&&this.listeners.has(update.match_id)){publicMatch(this.pool,update.match_id).then(score=>this.emit(score)).catch(error=>console.error('Score refresh:',error.message));}
          else this.emit(update);
        });
        client.on('error',error=>{
          console.error('Score listener:',error.message);
          if(this.client===client){this.client=null;client.release(true);}
          if(!this.closed&&this.listeners.size){const timer=setTimeout(()=>this.start().catch(()=>{}),100);timer.unref();}
        });
        await client.query('LISTEN nascon_scores');this.client=client;
      }catch(error){client.release(true);throw error;}
    })();
    try{await this.starting;}finally{this.starting=null;}
  }
  emit(score){for(const sink of this.listeners.get(score.match_id)??[])sink.send(score);}
  async subscribe(id,send){
    await this.start();
    const sink={last:null,version:-1,send(score){if(score.version<this.version)return;this.version=score.version;const key=`${score.version}|${score.status}`;if(key===this.last)return;this.last=key;send(envelope(score));}};
    if(!this.listeners.has(id))this.listeners.set(id,new Set());this.listeners.get(id).add(sink);
    return {send:score=>sink.send(score),close:()=>{const set=this.listeners.get(id);set?.delete(sink);if(!set?.size)this.listeners.delete(id);}};
  }
  async sse(req,res,id,actor){
    // Verify access before opening a long-lived success response.
    await publicMatch(this.pool,id,actor);
    let subscription;
    const close=()=>{clearInterval(heartbeat);subscription?.close();};
    let heartbeat;
    res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    subscription=await this.subscribe(id,message=>{
      if(res.destroyed)return;
      if(res.writableLength>1024*1024){res.destroy();return;}
      const json=JSON.stringify(message),identity=message.version;
      // Named score events and standard onmessage consumers share the same version.
      res.write(`id: ${identity}\nevent: score\ndata: ${json}\n\nid: ${identity}\ndata: ${json}\n\n`);
    });
    if(res.destroyed){subscription.close();return;}
    res.flushHeaders();
    this.responses.add(res);
    req.on('close',close);res.on('close',()=>{this.responses.delete(res);close();});
    heartbeat=setInterval(()=>res.write(': keep-alive\n\n'),15000);heartbeat.unref();
    try{subscription.send(await publicMatch(this.pool,id,actor));}catch(error){close();res.destroy(error);}
  }
  attach(server){
    const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});this.wss=wss;
    server.on('upgrade',async(req,socket,head)=>{
      const match=/^\/ws\/matches\/([^/?]+)$/.exec((req.url??'').split('?')[0]);
      if(!match){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
      try{
        const id=decodeURIComponent(match[1]);if(!validId(id))throw new DomainError(404,'MATCH_NOT_FOUND','Match does not exist');
        const actor=await publicActor(this.pool,this.tokens,req.headers.authorization);
        await publicMatch(this.pool,id,actor);await this.start();
        wss.handleUpgrade(req,socket,head,async ws=>{
          let subscription;
          ws.on('error',()=>{});ws.on('close',()=>subscription?.close());
          try{
            subscription=await this.subscribe(id,message=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024)ws.close(1008,'Slow subscriber');else ws.send(JSON.stringify(message));}});
            if(ws.readyState!==WebSocket.OPEN){subscription.close();return;}
            subscription.send(await publicMatch(this.pool,id,actor));
          }catch{subscription?.close();ws.close(1011,'Score subscription unavailable');}
        });
      }catch(error){
        const malformed=error instanceof URIError;
        const status=error.status??(malformed?400:503),body=JSON.stringify({error:{code:error.code??(malformed?'VALIDATION_ERROR':'NOT_READY'),message:error.message,details:error.details??(malformed?{fields:['match_id']}:{})}});
        socket.end(`HTTP/1.1 ${status} Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
      }
    });
    server.once('close',()=>this.close());
  }
  async close(){
    if(this.closed)return;
    this.closed=true;
    for(const res of this.responses)res.end();this.responses.clear();
    for(const ws of this.wss?.clients??[])ws.terminate();this.wss?.close();
    this.listeners.clear();
    if(this.starting)await this.starting.catch(()=>{});
    const client=this.client;this.client=null;
    if(client){try{await client.query('UNLISTEN nascon_scores');}finally{client.release();}}
  }
}
