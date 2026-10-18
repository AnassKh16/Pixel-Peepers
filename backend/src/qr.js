import {randomBytes} from 'node:crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import {signDay2} from './day2-signature.js';
import {getScore} from './scoring.js';
import {DomainError,validId} from './validation.js';

const origin='http://localhost:8080';
const missing=()=>{throw new DomainError(404,'QR_NOT_FOUND','Entity has no QR mapping');};

async function entityState(client,id) {
  const row=(await client.query(`SELECT 'match' AS kind,data FROM matches WHERE match_id=$1
    UNION ALL SELECT 'player','{}'::jsonb FROM players WHERE player_id=$1
    UNION ALL SELECT 'club','{}'::jsonb FROM clubs WHERE club_id=$1
    UNION ALL SELECT 'costream',data FROM costream_sessions WHERE session_id=$1 LIMIT 1`,[id])).rows[0];
  if(!row)missing();
  if(row.kind==='match'){
    const score=await getScore(client,id),status=row.data.status??score.status;
    const suffix={upcoming:'preview',in_progress:'live',completed:'vod'}[status]??`notice?state=${encodeURIComponent(status)}`;
    return {entity_type:'match',entity_status:status,target_route:`/web/matches/${encodeURIComponent(id)}/${suffix}`};
  }
  if(row.kind==='costream')return {entity_type:'costream',entity_status:row.data.response.status,target_route:`/web/costream/${encodeURIComponent(id)}`};
  return {entity_type:row.kind,entity_status:'active',target_route:`/web/${row.kind==='player'?'players':'clubs'}/${encodeURIComponent(id)}`};
}

export async function resolveQr(pool,id,{inspect=false,userAgent='',now=new Date()}={}) {
  if(!validId(id))missing();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    const state=await entityState(client,id);
    let mapping=(await client.query('SELECT data FROM qr_mappings WHERE entity_id=$1',[id])).rows[0]?.data;
    if(!mapping){
      const short_code=`q-${randomBytes(8).toString('hex')}`;
      const created={entity_id:id,entity_type:state.entity_type,short_code,short_url:`${origin}/q/${short_code}`,scan_count:0};
      await client.query('INSERT INTO qr_mappings(entity_id,data) VALUES ($1,$2) ON CONFLICT(entity_id) DO NOTHING',[id,created]);
      mapping=(await client.query('SELECT data FROM qr_mappings WHERE entity_id=$1',[id])).rows[0].data;
    }
    if(!inspect){
      mapping=(await client.query("UPDATE qr_mappings SET data=jsonb_set(data,'{scan_count}',to_jsonb(COALESCE((data->>'scan_count')::bigint,0)+1)) WHERE entity_id=$1 RETURNING data",[id])).rows[0].data;
      const family=/(Android|iPhone|iPad|Mobile)/i.test(typeof userAgent==='string'?userAgent:'')?'mobile':'desktop';
      const hour=now.toISOString().slice(0,13)+':00:00Z';
      await client.query('INSERT INTO qr_scan_telemetry(entity_id,device_family,utc_hour,scan_count) VALUES ($1,$2,$3,1) ON CONFLICT(entity_id,device_family,utc_hour) DO UPDATE SET scan_count=qr_scan_telemetry.scan_count+1',[id,family,hour]);
    }
    const payload={entity_id:id,short_url:mapping.short_url,target_route:state.target_route};
    const response={entity_id:id,entity_type:state.entity_type,entity_status:state.entity_status,short_url:mapping.short_url,target_route:state.target_route,
      deep_link_uri:`nascon://entity/${id}`,scan_count:mapping.scan_count,
      export_formats:Object.fromEntries(['svg','png','pdf'].map(format=>[format,`${origin}/audit/v1/qr/${encodeURIComponent(id)}/export.${format}`])),signature:signDay2(id,payload)};
    await client.query('COMMIT');return response;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function resolveShortCode(pool,code,options={}) {
  const row=(await pool.query("SELECT entity_id FROM qr_mappings WHERE data->>'short_code'=$1",[code])).rows[0];
  if(!row)missing();
  return resolveQr(pool,row.entity_id,options);
}

export async function exportQr(pool,id,format) {
  if(!['svg','png','pdf'].includes(format))missing();
  const qr=await resolveQr(pool,id,{inspect:true});
  if(format==='svg')return {type:'image/svg+xml',body:Buffer.from(await QRCode.toString(qr.short_url,{type:'svg',errorCorrectionLevel:'M',margin:2}),'utf8')};
  const png=await QRCode.toBuffer(qr.short_url,{type:'png',errorCorrectionLevel:'M',width:512,margin:2});
  if(format==='png')return {type:'image/png',body:png};
  const body=await new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:48}),chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.fontSize(22).text('NaSCon live access',{align:'center'});doc.moveDown();
    doc.fontSize(14).text(id,{align:'center'});doc.image(png,(doc.page.width-320)/2,150,{width:320});
    doc.fontSize(11).text(qr.short_url,48,500,{align:'center',link:qr.short_url});doc.end();
  });
  return {type:'application/pdf',body};
}
