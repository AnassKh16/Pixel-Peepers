import {randomBytes} from 'node:crypto';
import {canonical} from './signature.js';
import {signDay2} from './day2-signature.js';
import {DomainError, isObject, validationError, databaseText} from './validation.js';
import {verifyGuestWriteBlock} from './guest-boundary.js';

export async function issueGuestToken(pool) {
  const guest_token=`guest_anon_tok_${randomBytes(16).toString('hex')}`;
  const expires_at=new Date(Date.now()+3600000).toISOString();
  await pool.query('INSERT INTO guest_tokens(guest_token,data) VALUES ($1,$2)',[guest_token,{role:'guest',read_only:true,valid:true,merged:false,registered_user_id:null,expires_at}]);
  return {guest_token,role:'guest',read_only:true,expires_at};
}

export function validateCartMerge(body) {
  if(!isObject(body))validationError(['body']);
  const fields=[];
  if(!databaseText(body.guest_token)||!body.guest_token.startsWith('guest_')||!body.guest_token.length)fields.push('guest_token');
  if(!databaseText(body.registered_user_id)||!body.registered_user_id.length)fields.push('registered_user_id');
  if(!Array.isArray(body.guest_cart)||body.guest_cart.length<1||body.guest_cart.length>10)fields.push('guest_cart');
  else body.guest_cart.forEach((item,i)=>{
    if(!isObject(item)){fields.push(`guest_cart.${i}`);return;}
    if(!databaseText(item.variant_id)||!item.variant_id.length)fields.push(`guest_cart.${i}.variant_id`);
    if(!Number.isSafeInteger(item.quantity)||item.quantity<1)fields.push(`guest_cart.${i}.quantity`);
  });
  if(body.test_write_block!==undefined&&typeof body.test_write_block!=='boolean')fields.push('test_write_block');
  if(fields.length)validationError(fields);
  return {guest_token:body.guest_token,registered_user_id:body.registered_user_id,guest_cart:body.guest_cart.map(({variant_id,quantity})=>({variant_id,quantity})),test_write_block:body.test_write_block??true};
}

export async function mergeGuestCart(pool,body,sign=signDay2) {
  const request=validateCartMerge(body),client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    if(!(await client.query('SELECT 1 FROM players WHERE player_id=$1',[request.registered_user_id])).rowCount)
      throw new DomainError(404,'PLAYER_NOT_FOUND','Registered player does not exist');
    const ids=request.guest_cart.map(item=>item.variant_id);
    const known=new Set((await client.query('SELECT variant_id FROM variants WHERE variant_id=ANY($1::text[])',[ids])).rows.map(row=>row.variant_id));
    for(const id of ids)if(!known.has(id))throw new DomainError(404,'VARIANT_NOT_FOUND','Variant does not exist',{variant_id:id});
    await client.query('SELECT pg_advisory_xact_lock(522,hashtext($1))',[request.guest_token]);
    const prior=(await client.query('SELECT data FROM guest_tokens WHERE guest_token=$1 FOR UPDATE',[request.guest_token])).rows[0]?.data;
    const identity={registered_user_id:request.registered_user_id,guest_cart:request.guest_cart};
    if(prior?.merged&&canonical(prior.merge_request)===canonical(identity)){
      await client.query('COMMIT');return prior.merge_response;
    }
    await client.query('INSERT INTO user_carts(user_id,data) VALUES ($1,$2) ON CONFLICT DO NOTHING',[request.registered_user_id,{items:[]}]);
    const cart=(await client.query('SELECT data FROM user_carts WHERE user_id=$1 FOR UPDATE',[request.registered_user_id])).rows[0].data;
    const quantities=new Map();
    for(const item of [...(cart.items??[]),...request.guest_cart])quantities.set(item.variant_id,(quantities.get(item.variant_id)??0n)+BigInt(item.quantity));
    const rows=(await client.query('SELECT variant_id,price_minor,stock FROM variants WHERE variant_id=ANY($1::text[]) ORDER BY variant_id FOR UPDATE',[[...quantities.keys()]])).rows;
    const variants=new Map(rows.map(row=>[row.variant_id,row]));
    for(const [id,quantity]of quantities){
      if(!variants.has(id))throw new DomainError(404,'VARIANT_NOT_FOUND','Variant does not exist',{variant_id:id});
      if(quantity>BigInt(variants.get(id).stock))throw new DomainError(409,'OUT_OF_STOCK','Merged cart exceeds available stock',{variant_id:id});
    }
    if(prior?.merged)throw new DomainError(409,'GUEST_TOKEN_ALREADY_MERGED','Guest token has already been merged');
    const write_block_verified=request.test_write_block?verifyGuestWriteBlock(request.guest_token):false;
    const write_rejection_code=write_block_verified?403:0;
    const items=[...quantities].map(([variant_id,quantity])=>({variant_id,quantity:Number(quantity),unit_price_minor:variants.get(variant_id).price_minor}));
    const active_cart={user_id:request.registered_user_id,currency:'PKR',total_items:items.reduce((n,item)=>n+item.quantity,0),subtotal_minor:items.reduce((n,item)=>n+item.quantity*item.unit_price_minor,0),items};
    const response={guest_token:request.guest_token,write_block_verified,write_rejection_code,cart_merged:true,active_cart,
      signature:sign(request.guest_token,{cart_merged:true,guest_token:request.guest_token,registered_user_id:request.registered_user_id,total_items:active_cart.total_items,write_rejection_code})};
    await client.query('UPDATE user_carts SET data=$2 WHERE user_id=$1',[request.registered_user_id,active_cart]);
    await client.query('INSERT INTO guest_tokens(guest_token,data) VALUES ($1,$2) ON CONFLICT(guest_token) DO UPDATE SET data=EXCLUDED.data',[request.guest_token,{...prior,role:'guest',read_only:true,valid:false,merged:true,registered_user_id:request.registered_user_id,merge_request:identity,merge_response:response}]);
    // Carts do not reserve inventory. Checkout remains the only stock reservation path.
    await client.query('COMMIT');return response;
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
