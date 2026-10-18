import {redactRecord} from './privacy.js';
import express from 'express';
import {compare} from 'bcryptjs';
import {DomainError,isObject,validationError} from './validation.js';
import {permits,findTarget} from './policy.js';
import {appendEvent,getScore,validateEvent} from './scoring.js';
import {getStandings} from './standings.js';
import {checkout,validateCheckout} from './checkout.js';
import {validateRoster} from './roster.js';
import {validateSync,syncActions} from './offline-sync.js';
const denied=()=>{throw new DomainError(403,'FORBIDDEN','Access denied');};
const unauthenticated=()=>{throw new DomainError(401,'UNAUTHENTICATED','Valid credentials required');};
const publicUser=u=>({id:u.user_id,email:u.email,tenant_id:u.tenant_id,club_id:u.club_id,league_id:u.league_id,player_id:u.player_id});
export function mobileRouter(pool,redis,tokens,sign,json) {
  const router=express.Router();
  const route=(method,path,...handlers)=>router[method](path,...handlers.map(fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next)));
  router.options('*',(_req,res)=>res.sendStatus(204));
  router.get('/ping',(_req,_res,next)=>next('router'));
  route('post','/auth/login',json,async(req,res)=>{
    if(!isObject(req.body)||typeof req.body.email!=='string'||typeof req.body.password!=='string'||req.body.email.length>254||req.body.password.length>256)unauthenticated();
    const user=(await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)',[req.body.email.trim()])).rows[0];
    if(!user||!await compare(req.body.password,user.password_hash))unauthenticated();
    const {user_id:sub,role,tenant_id,league_id,club_id,player_id}=user;
    res.json({token:tokens.issue({sub,role,tenant_id,league_id,club_id,player_id}),role,user:publicUser(user)});
  });
  router.use(async(req,_res,next)=>{try{
    const claims=tokens.verify(req.headers.authorization);if(!claims)unauthenticated();
    const user=(await pool.query('SELECT * FROM users WHERE user_id=$1',[claims.sub])).rows[0];if(!user)unauthenticated();
    req.actor={sub:user.user_id,role:user.role,tenant_id:user.tenant_id,club_id:user.club_id,league_id:user.league_id,player_id:user.player_id};req.account=user;next();
  }catch(error){next(error);}});
  router.use(json);
  const league=async(actor,id,action='league_read')=>{
    const target=(await pool.query('SELECT league_id,tenant_id,config FROM leagues WHERE league_id=$1',[id])).rows[0];
    if(target&&!permits(actor,action,target))denied();
    if(!target)throw new DomainError(404,'LEAGUE_NOT_FOUND','League not found');return target;
  };
  const authorizeScore=async(actor,body)=>{
    if(!permits(actor,'score',{tenant_id:actor.tenant_id,league_id:actor.league_id}))denied();
    const meta=(await pool.query('SELECT data FROM matches WHERE match_id=$1',[typeof body?.match_id==='string'?body.match_id:''])).rows[0]?.data;
    const id=meta?.league_id??body?.payload?.league_id;
    if(id)await league(actor,id,'score');else if(actor.role!=='super_admin')denied();
  };
  const authorizeRoster=async(actor,body)=>{
    if(!permits(actor,'roster',{tenant_id:actor.tenant_id,club_id:actor.club_id}))denied();
    const scenario=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',[typeof body?.league_id==='string'?body.league_id:''])).rows[0]?.data;
    if(scenario){
      if(actor.role!=='super_admin'&&scenario.league.tenant_id!==actor.tenant_id)denied();
      const squad=scenario.squads.find(s=>s.squad_id===body.from_squad_id);
      if(squad&&!permits(actor,'roster',squad))denied();
    }
  };
  route('get','/sports',async(_req,res)=>{
    const {rows}=await pool.query('SELECT config FROM sports ORDER BY sport_id');
    res.json({sports:rows.map(row=>row.config)});
  });
  route('get','/sports/:sport_id',async(req,res)=>{
    const row=(await pool.query('SELECT config FROM sports WHERE sport_id=$1',[req.params.sport_id])).rows[0];
    if(!row)throw new DomainError(404,'SPORT_NOT_FOUND','Sport not found');
    res.json(row.config);
  });
  route('get','/me',async(req,res)=>res.json({role:req.actor.role,user:publicUser(req.account)}));
  route('get','/leagues',async(req,res)=>{
    const rows=(await pool.query('SELECT league_id,tenant_id,config FROM leagues ORDER BY league_id')).rows.filter(row=>permits(req.actor,'league_read',row));
    res.json({leagues:rows.map(({league_id,tenant_id,config:c})=>({league_id,tenant_id,name:c.name??league_id,sport_id:c.sport_id,teams:c.teams.map(team_id=>({team_id,name:c.team_names?.[team_id]??team_id})),fixture_count:c.fixtures.length,qualification:c.qualification}))});
  });
  route('get','/leagues/:id/fixtures',async(req,res)=>{
    const {config:c}=await league(req.actor,req.params.id);
    const fixtures=await Promise.all(c.fixtures.map(async f=>{const s=await getScore(pool,f.match_id);return {match_id:f.match_id,league_id:req.params.id,sport_id:c.sport_id,starts_at:f.starts_at??null,status:s.status,home:{team_id:f.home,name:c.team_names?.[f.home]??f.home},away:{team_id:f.away,name:c.team_names?.[f.away]??f.away},score:{home:s.home,away:s.away},version:s.version};}));
    res.json({league_id:req.params.id,fixtures});
  });
  route('get','/leagues/:id/standings',async(req,res)=>{await league(req.actor,req.params.id);res.json(await getStandings(pool,req.params.id));});
  route('get','/matches/:id',async(req,res)=>{
    const meta=(await pool.query('SELECT data FROM matches WHERE match_id=$1',[req.params.id])).rows[0]?.data;
    if(meta){if(meta.league_id)await league(req.actor,meta.league_id);else if(req.actor.role!=='super_admin')denied();}
    res.json(await getScore(pool,req.params.id));
  });
  route('get','/clubs/:id',async(req,res)=>{
    const target=await findTarget(pool,'club',req.params.id);
    if(target&&!permits(req.actor,'club',target))denied();if(!target)throw new DomainError(404,'CLUB_NOT_FOUND','Club not found');
    const profile=(await pool.query('SELECT data FROM club_profiles WHERE club_id=$1',[req.params.id])).rows[0]?.data??{name:req.params.id,description:'',home_venue:null,social_handles:{},staff:[]};
    const registrations=(await pool.query('SELECT data FROM rosters')).rows.flatMap(({data})=>data.players.filter(p=>data.squads.some(s=>s.club_id===req.params.id&&s.squad_id===p.squad_id)).map(p=>({...p,league_id:data.league.league_id})));
    res.json({...profile,...target,roster:await redactRecord(registrations,pool)});
  });
  route('get','/products',async(req,res)=>{
    const rows=(await pool.query('SELECT p.*,pp.data AS profile FROM products p LEFT JOIN product_profiles pp USING(product_id) ORDER BY product_id')).rows.filter(p=>permits(req.actor,'catalogue',p));
    const products=await Promise.all(rows.map(async p=>({product_id:p.product_id,tenant_id:p.tenant_id,club_id:p.profile?.club_id??null,name:p.profile?.name??p.product_id,description:p.profile?.description??'',category:p.profile?.category??null,variants:(await pool.query('SELECT variant_id,price_minor,currency,stock,reserved FROM variants WHERE product_id=$1 ORDER BY variant_id',[p.product_id])).rows.map(v=>({...p.profile?.variants?.[v.variant_id],...v,stock:Number(v.stock),reserved:Number(v.reserved)}))})));
    res.json({products});
  });
  route('post','/checkout',async(req,res)=>{
    if(isObject(req.body)&&req.body.customer_id!==undefined&&req.body.customer_id!==req.actor.sub)denied();
    const request=validateCheckout(isObject(req.body)?{...req.body,customer_id:req.actor.sub}:req.body);
    const rows=(await pool.query('SELECT p.tenant_id FROM variants v JOIN products p USING(product_id) WHERE v.variant_id=ANY($1::text[])',[request.items.map(i=>i.variant_id)])).rows;
    if(rows.some(row=>!permits(req.actor,'purchase',row)))denied();
    const result=await checkout(pool,redis,sign,request);res.status(result.status).json(result.response);
  });
  route('post','/events',async(req,res)=>{await authorizeScore(req.actor,req.body);const result=await appendEvent(pool,sign,validateEvent(req.body));res.status(result.status).json(result.response);});
  route('post','/offline-sync',async(req,res)=>{
    const body=validateSync(req.body,{legacy:true});
    // Authorize the entire batch before applying any queued action.
    for(const a of body.actions)if(a.type==='score_event')await authorizeScore(req.actor,a.payload);else await authorizeRoster(req.actor,a.payload);
    res.json(await syncActions(pool,sign,req.actor,body,{legacy:true}));
  });
  return router;
}

