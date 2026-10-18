import {redactRecord} from './privacy.js';
import {getScore} from './scoring.js';
import {scoreView} from './score-view.js';
import {permits} from './policy.js';
import {guestToken} from './guest-boundary.js';
import {DomainError,validId} from './validation.js';

export async function publicActor(pool,tokens,authorization) {
  if(!authorization||guestToken(authorization))return null;
  const claims=tokens.verify(authorization);
  if(!claims)throw new DomainError(401,'UNAUTHENTICATED','Valid bearer token required');
  const user=(await pool.query('SELECT user_id,role,tenant_id,league_id,club_id,player_id FROM users WHERE user_id=$1',[claims.sub])).rows[0];
  if(!user)throw new DomainError(401,'UNAUTHENTICATED','Valid bearer token required');
  return {sub:user.user_id,role:user.role,tenant_id:user.tenant_id,league_id:user.league_id,club_id:user.club_id,player_id:user.player_id};
}

export async function publicMatch(pool,id,actor=null) {
  if(!validId(id))throw new DomainError(404,'MATCH_NOT_FOUND','Match does not exist');
  const projection=await getScore(pool,id);
  const meta=(await pool.query('SELECT data FROM matches WHERE match_id=$1',[id])).rows[0].data;
  if(actor){
    const league=meta.league_id?(await pool.query('SELECT league_id,tenant_id FROM leagues WHERE league_id=$1',[meta.league_id])).rows[0]:null;
    if(actor.role!=='super_admin'&&(!league||!permits(actor,'league_read',league)))throw new DomainError(403,'FORBIDDEN','Access denied');
  }
  // Administrative postponements/cancellations are live metadata; scores still fold the log.
  if(['upcoming','in_progress','completed','postponed','cancelled','abandoned'].includes(meta.status))projection.status=meta.status;
  return scoreView(projection);
}

export async function publicPlayer(pool,id,actor=null) {
  if(!validId(id))throw new DomainError(404,'PLAYER_NOT_FOUND','Player does not exist');
  const row=(await pool.query('SELECT p.player_id,p.club_id,c.tenant_id,pp.data FROM players p JOIN clubs c USING(club_id) LEFT JOIN player_profiles pp USING(player_id) WHERE p.player_id=$1',[id])).rows[0];
  if(!row)throw new DomainError(404,'PLAYER_NOT_FOUND','Player does not exist');
  if(actor&&!permits(actor,'club',row))throw new DomainError(403,'FORBIDDEN','Access denied');
  return {player_id:row.player_id,club_id:row.club_id,name:row.data?.name??row.player_id,position:row.data?.position??null};
}

export async function publicClub(pool,id) {
  if(!validId(id))throw new DomainError(404,'CLUB_NOT_FOUND','Club does not exist');
  const row=(await pool.query('SELECT c.club_id,cp.data FROM clubs c LEFT JOIN club_profiles cp USING(club_id) WHERE c.club_id=$1',[id])).rows[0];
  if(!row)throw new DomainError(404,'CLUB_NOT_FOUND','Club does not exist');
  const p=row.data??{};
  const roster=(await pool.query('SELECT data FROM rosters')).rows.flatMap(({data})=>data.players.filter(player=>data.squads.some(s=>s.club_id===id&&s.squad_id===player.squad_id)).map(player=>({player_id:player.player_id,name:player.name,position:player.position,role:player.role})));
  return {club_id:id,name:p.name??id,description:p.description??'',home_venue:p.home_venue?Object.fromEntries(['name','address','latitude','longitude'].filter(key=>p.home_venue[key]!==undefined).map(key=>[key,p.home_venue[key]])):null,social_handles:p.social_handles??{},staff:(p.staff??[]).map(person=>({name:person.name,role:person.role})),roster:await redactRecord(roster,pool)};
}

export async function publicProducts(pool) {
  const rows=(await pool.query('SELECT p.product_id,pp.data FROM products p LEFT JOIN product_profiles pp USING(product_id) ORDER BY product_id')).rows;
  const products=await Promise.all(rows.map(async row=>{
    const p=row.data??{};
    const variants=(await pool.query('SELECT variant_id,price_minor,currency,stock FROM variants WHERE product_id=$1 ORDER BY variant_id',[row.product_id])).rows.map(v=>({variant_id:v.variant_id,size:p.variants?.[v.variant_id]?.size??null,color:p.variants?.[v.variant_id]?.color??null,price_minor:v.price_minor,currency:v.currency,stock:Number(v.stock)}));
    return {product_id:row.product_id,club_id:p.club_id??null,name:p.name??row.product_id,description:p.description??'',category:p.category??null,variants};
  }));
  return {products};
}
