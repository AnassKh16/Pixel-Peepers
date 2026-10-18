import express from 'express';
import {publicActor,publicMatch,publicPlayer,publicClub,publicProducts} from './public-data.js';
import {issueGuestToken} from './guest-cart.js';
import {postChat,recentChat} from './chat.js';
import {DomainError,databaseText} from './validation.js';

export function publicRouter(pool,tokens,json,streams){
  const router=express.Router();
  const route=(method,path,...handlers)=>router[method](path,...handlers.map(fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next)));
  const actor=async(req,_res,next)=>{req.publicActor=await publicActor(pool,tokens,req.headers.authorization);next();};
  route('post','/guest/token',json,async(_req,res)=>res.status(201).json(await issueGuestToken(pool)));
  route('get','/matches/:id/summary',async(req,res)=>{
    const {match_id,status,home,away,score}=await publicMatch(pool,req.params.id);
    res.set('Cache-Control','no-store').json({match_id,status,home,away,score});
  });
  route('get','/matches/:id/stream',actor,async(req,res)=>streams.sse(req,res,req.params.id,req.publicActor));
  route('get','/matches/:id',actor,async(req,res,next)=>{
    if(req.publicActor){next();return;} // Preserve the existing member response and RBAC checks.
    res.set('Cache-Control','no-store').json(await publicMatch(pool,req.params.id));
  });
  route('get','/clubs/:id',actor,async(req,res,next)=>{
    if(req.publicActor){next();return;}
    res.json(await publicClub(pool,req.params.id));
  });
  route('get','/players/:id',actor,async(req,res)=>res.json(await publicPlayer(pool,req.params.id,req.publicActor)));
  route('get','/products',actor,async(req,res,next)=>{
    if(req.publicActor){next();return;}
    res.json(await publicProducts(pool));
  });
  route('get','/costream/:id',actor,async(req,res)=>{
    if(!databaseText(req.params.id))throw new DomainError(404,'STREAM_NOT_FOUND','Co-stream does not exist');
    const row=(await pool.query('SELECT data FROM costream_sessions WHERE session_id=$1',[req.params.id])).rows[0];
    if(!row)throw new DomainError(404,'STREAM_NOT_FOUND','Co-stream does not exist');
    res.set('Cache-Control','no-store').json({...row.data.response,participants:row.data.response.active_participants});
  });
  route('get','/chat',actor,async(req,res)=>res.json(await recentChat(pool,req.query)));
  route('post','/chat',actor,json,async(req,res)=>{
    const result=await postChat(pool,req.publicActor,req.body);res.status(result.status).json(result.response);
  });
  return router;
}
