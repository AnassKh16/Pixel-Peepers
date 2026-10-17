import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base='http://localhost:8080',records=[],signed=[];
const T={string:v=>typeof v==='string',number:v=>typeof v==='number'&&Number.isFinite(v),integer:v=>Number.isInteger(v),boolean:v=>typeof v==='boolean',object:v=>v!==null&&typeof v==='object'&&!Array.isArray(v),hex:v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),nullableString:v=>v===null||typeof v==='string',nullableNumber:v=>v===null||Number.isFinite(v),nullableBoolean:v=>v===null||typeof v==='boolean'};
function differences(v,s,p='$',out=[]){
  if(typeof s==='function'){if(!s(v))out.push(`${p}: wrong type/value ${JSON.stringify(v)}`);return out;}
  if(s===null){if(v!==null)out.push(`${p}: expected explicit null`);return out;}
  if(Array.isArray(s)){if(!Array.isArray(v))out.push(`${p}: expected array`);else if(s.length>1){if(v.length!==s.length)out.push(`${p}: array length differs`);v.forEach((x,i)=>{if(i<s.length)differences(x,s[i],`${p}[${i}]`,out);});}else if(s.length)v.forEach((x,i)=>differences(x,s[0],`${p}[${i}]`,out));return out;}
  if(typeof s==='object'){
    if(!T.object(v)){out.push(`${p}: expected object`);return out;}
    for(const k of Object.keys(s))if(!Object.hasOwn(v,k))out.push(`${p}.${k}: missing`);else differences(v[k],s[k],`${p}.${k}`,out);
    for(const k of Object.keys(v))if(!Object.hasOwn(s,k))out.push(`${p}.${k}: unexpected field`);
    return out;
  }
  if(v!==s)out.push(`${p}: expected ${JSON.stringify(s)}, got ${JSON.stringify(v)}`);return out;
}
function curl(path,body,{method=body===undefined?'GET':'POST',token,raw}={}){
  const args=['--silent','--show-error','--max-time','12','--write-out','\n%{http_code}','-X',method,'-H','Content-Type: application/json'];
  if(token)args.push('-H',`Authorization: Bearer ${token}`);
  const input=raw??(body===undefined?undefined:JSON.stringify(body));if(input!==undefined)args.push('--data-binary','@-');args.push(base+path);
  const start=Date.now(),r=spawnSync(process.platform==='win32'?'curl.exe':'curl',args,{input,encoding:'utf8',maxBuffer:12*1024*1024});
  if(r.status!==0)throw new Error(`curl ${path}: ${r.stderr||r.error}`);
  const cut=r.stdout.lastIndexOf('\n');return {status:Number(r.stdout.slice(cut+1)),body:JSON.parse(r.stdout.slice(0,cut)),elapsed_ms:Date.now()-start};
}
function check(label,path,body,schema,status=200,options={}){
  const r=curl(path,body,options),issues=differences(r.body,schema);if(r.status!==status)issues.unshift(`HTTP: expected ${status}, got ${r.status}`);
  if(path==='/audit/v1/events'&&r.status<300)signed.push({id:body.event_id,payload:body.payload,signature:r.body.signature});
  if(path==='/audit/v1/checkout'&&r.status<300)signed.push({id:body.order_id,payload:r.body.receipt.payload,signature:r.body.receipt.signature});
  records.push({label,method:options.method??(body===undefined?'GET':'POST'),path,status:r.status,expected_status:status,issues});
  console.log(`${issues.length?'MISMATCH':'PASS'} ${label}${issues.length?' '+issues.join('; '):''}`);return r.body;
}
const error=code=>({error:{code,message:T.string,details:T.object}});
const team={team_id:T.string,score:T.number,wickets:T.nullableNumber,balls:T.nullableNumber,overs:T.nullableString,fair_play:T.number};
const eventResponse={event_id:T.string,match_id:T.string,type:T.string,sequence:T.integer,match_version:T.integer,signature:T.hex};
const eventRecord={sequence:T.integer,event_id:T.string,type:T.string,payload:T.object,signature:T.hex,compensated:T.boolean,compensated_by:T.nullableString};
const scoreSchema={match_id:T.string,sport_id:T.string,league_id:T.nullableString,status:T.string,outcome:T.string,winner_team_id:T.nullableString,tiebreak_winner_team_id:T.nullableString,home:team,away:team,version:T.integer,events:[eventRecord]};
const match={match_id:T.string,bracket:T.string,round:T.integer,index:T.integer,home:T.nullableString,away:T.nullableString,home_seed:T.nullableNumber,away_seed:T.nullableNumber,bye:T.boolean,winner:T.nullableString,loser:T.nullableString,winner_to:v=>v===null||differences(v,{match_id:T.string,slot:T.string}).length===0,loser_to:v=>v===null||differences(v,{match_id:T.string,slot:T.string}).length===0};
const sport={sport_id:'kabaddi',name:'Kabaddi',scoring_model:'event',periods:{count:2,duration_minutes:20},scoring_events:{raid_point:{points:1},tackle_point:{points:1},all_out:{points:2}},draw_allowed:false,overtime:{policy:'golden_score',duration_minutes:5},tie_break_order:['h2h_points','h2h_diff','overall_diff','scored','fair_play','draw_lots'],roster:{min_squad_size:7,max_squad_size:12,required_positions:{raider:2,defender:3}}};
const audit={audit_id:T.string,action:T.string,player_id:T.string,league_id:T.string,from_squad_id:T.nullableString,to_squad_id:T.nullableString,effective_date:T.string,state:T.string,who:T.string,when:T.string,why:T.string};
const registration={player_id:T.string,league_id:T.string,squad_id:T.string,parent_squad_id:T.nullableString,registration_type:T.string,start_date:T.string,loan_end_date:T.nullableString,role:T.string};
const roster={league:{league_id:'lg-r1',tenant_id:'tenant-alpha',sport_id:'football',transfer_window:{open:'2026-09-01',close:'2026-09-30'},max_squad_size:3,required_positions:{gk:1}},squads:[{squad_id:'sq-a',club_id:'club-a',tenant_id:'tenant-alpha',name:'A'},{squad_id:'sq-b',club_id:'club-b',tenant_id:'tenant-alpha',name:'B'}],players:[{player_id:'p1',name:'Ali',position:'gk',squad_id:'sq-a',role:'captain'},{player_id:'p2',name:'Bilal',position:'df',squad_id:'sq-a',role:'starter'}],matches_in_progress:[{match_id:'m-live',home_squad_id:'sq-a',away_squad_id:'sq-b'}]};
const transfer={request_id:'tr-001',league_id:'lg-r1',player_id:'p2',type:'transfer',from_squad_id:'sq-a',to_squad_id:'sq-b',effective_date:'2026-09-30',loan_end_date:null,reason:'Tactical move',requested_by:'user-77'};
const resetExpected={status:'reset_complete',seed:42,sports:['football','basketball','cricket','esports'],tenants:['tenant-alpha','tenant-beta'],stock:{'var-jersey-001-M':1,'var-jersey-001-L':5}};
const dump=()=>{
 const code="import pg from 'pg'; import {createHash} from 'node:crypto'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL}); const result={}; for(const {tablename} of (await p.query(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\")).rows) result[tablename]=(await p.query('SELECT * FROM '+tablename+' ORDER BY 1')).rows; result.audit_sequence=(await p.query('SELECT last_value,is_called FROM roster_audit_seq')).rows; console.log(createHash('sha256').update(JSON.stringify(result)).digest('hex')); await p.end();";
 const r=spawnSync('docker',['compose','exec','-T','backend','node','--input-type=module','-e',code],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();
};
try{
 check('5.4 health','/health',undefined,{status:'ok'});
 check('5.5 reset','/audit/v1/reset',{},resetExpected);
 const first=dump();check('Appendix C second reset','/audit/v1/reset',{},resetExpected);const second=dump();records.push({label:'Appendix C all tables + audit sequence identical after two resets',issues:first===second?[]:['Database snapshots differ']});
 check('5.6 sport creation','/audit/v1/sports',sport,{sport_id:'kabaddi',status:'created',config:sport},201);
 check('5.6 duplicate sport','/audit/v1/sports',sport,error('SPORT_EXISTS'),409);
 check('5.7A round robin','/audit/v1/fixtures',{format:'round_robin',teams:['t1','t2','t3','t4','t5'],params:{legs:1,withdrawals:[{team_id:'t3',after_round:2}],withdrawal_policy:'forfeit_remaining'}},{format:'round_robin',legs:1,team_count:5,round_count:5,rounds:[{round:T.integer,matches:[{match_id:T.string,leg:T.integer,home:T.string,away:T.string,status:T.string,awarded_to:T.nullableString}],byes:[T.string]}],summary:{total:10,scheduled:T.integer,forfeit:T.integer,voided:0}});
 check('5.7B Swiss','/audit/v1/fixtures',{format:'swiss',teams:['t1','t2','t3','t4','t5'],params:{total_rounds:3,round:2,history:[{round:1,bye:'t5',matches:[{home:'t1',away:'t3',result:'home'},{home:'t2',away:'t4',result:'draw'}]}]}},{format:'swiss',round:2,total_rounds:3,pairings:[{match_id:T.string,home:T.string,away:T.string}],bye:T.string,standings:[{rank:T.integer,team_id:T.string,score:T.number,buchholz:T.number}]});
 check('5.7C single elimination','/audit/v1/fixtures',{format:'single_elim',teams:['t1','t2','t3','t4','t5','t6'],params:{third_place_match:false,results:[{match_id:'R1M2',winner:'t4'}]}},{format:'single_elim',bracket_size:8,rounds:[{round:T.integer,matches:[match]}]});
 check('5.7D double elimination','/audit/v1/fixtures',{format:'double_elim',teams:['t1','t2','t3','t4','t5','t6','t7','t8'],params:{bracket_reset:true,results:[{match_id:'WR1M1',winner:'t1'}]}},{format:'double_elim',bracket_size:8,bracket_reset:true,winners:[{round:T.integer,matches:[{...match,conditional:T.boolean,required:T.nullableBoolean}]}],losers:[{round:T.integer,matches:[{...match,conditional:T.boolean,required:T.nullableBoolean}]}],grand_final:[{...match,conditional:T.boolean,required:T.nullableBoolean}]});
 check('5.8 league registration','/audit/v1/leagues',{league_id:'lg-1',sport_id:'football',teams:['t1','t2','t3','t4'],fixtures:[{match_id:'m1',home:'t1',away:'t2'},{match_id:'m2',home:'t3',away:'t4'}],points:{win:3,draw:1,loss:0},tie_break_order:sport.tie_break_order,qualification:{spots:2},lots_seed:42},{league_id:'lg-1',status:'created',team_count:4,fixture_count:2},201);
 const events=[['match_init',{sport_id:'football',home_team_id:'t1',away_team_id:'t2',league_id:'lg-1'}],['match_start',{}],['score',{team_id:'t1',event_type:'goal'}],['score',{team_id:'t1',event_type:'goal'}],['score',{team_id:'t2',event_type:'goal'}],['discipline',{team_id:'t2',points:-1}],['discipline',{team_id:'t1',points:0}],['discipline',{team_id:'t2',points:0}],['match_end',{}]];
 for(const [i,[type,payload]]of events.entries())check('5.9 '+type,'/audit/v1/events',{event_id:`evt-${i+1}`,match_id:'m-score',type,payload},eventResponse,201);
 check('5.9 score projection','/audit/v1/score/m-score',undefined,{...scoreSchema,match_id:'m-score',sport_id:'football',league_id:'lg-1',status:'completed',outcome:'home_win',winner_team_id:'t1',tiebreak_winner_team_id:null,home:{team_id:'t1',score:2,wickets:null,balls:null,overs:null,fair_play:0},away:{team_id:'t2',score:1,wickets:null,balls:null,overs:null,fair_play:-1},version:9});
 check('5.9 replay','/audit/v1/events',{event_id:'evt-9',match_id:'m-score',type:'match_end',payload:{}},eventResponse,200);
 for(const model of [{id:'cricket',event:'single',home:{team_id:'t1',score:1,wickets:0,balls:1,overs:'0.1',fair_play:0}},{id:'esports',event:'round_win',home:{team_id:'t1',score:1,wickets:null,balls:null,overs:null,fair_play:0}}]){
   const match_id='m-model-'+model.id;
   for(const [i,[type,payload]]of [['match_init',{sport_id:model.id,home_team_id:'t1',away_team_id:'t2'}],['match_start',{}],['score',{team_id:'t1',event_type:model.event}]].entries())check('5.9 '+model.id+' '+type,'/audit/v1/events',{event_id:match_id+'-'+i,match_id,type,payload},eventResponse,201);
   check('5.9 '+model.id+' nullable fields','/audit/v1/score/'+match_id,undefined,{...scoreSchema,league_id:null,status:'in_progress',outcome:'pending',home:model.home});
 }
 const tieEvents=[['match_init',{sport_id:'kabaddi',home_team_id:'h',away_team_id:'a'}],['match_start',{}],['tiebreak_winner',{team_id:'h'}],['match_end',{}],['compensation',{compensates:'tie-2',reason:'Correction after completion'}]];
 for(const [i,[type,payload]]of tieEvents.entries())check('5.9 tie/compensation '+type,'/audit/v1/events',{event_id:'tie-'+i,match_id:'m-tie',type,payload},eventResponse,201);
 check('5.9 completed compensation projection','/audit/v1/score/m-tie',undefined,{...scoreSchema,league_id:null,status:'completed',outcome:'undecided',winner_team_id:null,tiebreak_winner_team_id:null});
 check('5.10 standings','/audit/v1/standings/lg-1',undefined,{league_id:'lg-1',sport_id:'football',qualification_spots:2,table:[{rank:T.integer,team_id:T.string,played:T.integer,won:T.integer,drawn:T.integer,lost:T.integer,scored:T.number,conceded:T.number,diff:T.number,points:T.integer,fair_play:T.integer,status:T.string,resolved_by:T.nullableString}],h2h:v=>Object.keys(v).length===4&&Object.values(v).every(row=>Object.keys(row).length===4&&Object.values(row).every(cell=>differences(cell,{played:T.integer,points:T.number,scored:T.number,conceded:T.number}).length===0))});
 check('5.11 roster setup','/audit/v1/roster/setup',roster,{league_id:'lg-r1',status:'configured',squad_counts:{'sq-a':2,'sq-b':0}},201);
 check('5.11 deferred transfer','/audit/v1/roster/transfer',transfer,{request_id:'tr-001',status:'accepted',state:'deferred_until_match_end',blocking_match_id:'m-live',registration,audit_entry:audit},201);
 check('5.11 transfer replay','/audit/v1/roster/transfer',transfer,{request_id:'tr-001',status:'accepted',state:'deferred_until_match_end',blocking_match_id:'m-live',registration,audit_entry:audit},200);
 check('5.11 history','/audit/v1/roster/history/p2?as_of=2027-01-05',undefined,{player_id:'p2',as_of:'2027-01-05',league_id:'lg-r1',current_squad_id:'sq-b',parent_squad_id:null,history:[audit]});
 check('5.11 setup replaces state','/audit/v1/roster/setup',{...roster,matches_in_progress:[]},{league_id:'lg-r1',status:'configured',squad_counts:{'sq-a':2,'sq-b':0}},201);
 check('5.11 loan','/audit/v1/roster/transfer',{...transfer,request_id:'loan-001',type:'loan',loan_end_date:'2026-12-31'},{request_id:'loan-001',status:'accepted',state:'active',blocking_match_id:null,registration:{...registration,registration_type:'loan',parent_squad_id:'sq-a',loan_end_date:'2026-12-31'},audit_entry:audit},201);
 const h=check('5.11 automatic return','/audit/v1/roster/history/p2?as_of=2027-01-05',undefined,{player_id:'p2',as_of:'2027-01-05',league_id:'lg-r1',current_squad_id:'sq-a',parent_squad_id:null,history:[audit]});assert.deepEqual(h.history.map(a=>a.action),['loan','loan_return']);assert.deepEqual(curl('/audit/v1/roster/history/p2?as_of=2027-01-05').body,h);
 const item={variant_id:'var-jersey-001-M',quantity:1,unit_price_minor:450000},order={order_id:'ord-001',customer_id:'cust-001',items:[{variant_id:'var-jersey-001-M',quantity:1}],discount_code:null,payment:{token:'tok_success'}};
 const paid=check('5.12 checkout','/audit/v1/checkout',order,{order_id:'ord-001',status:'paid',currency:'PKR',items:[item],subtotal_minor:450000,discount_minor:0,total_minor:450000,payment:{authorization_id:T.string,capture_id:T.string,state:'captured'},receipt:{payload:{order_id:'ord-001',customer_id:'cust-001',items:[item],subtotal_minor:450000,discount_minor:0,total_minor:450000,currency:'PKR',paid_at:T.string},signature:T.hex,pdf_base64:T.string}},201);assert.ok(Buffer.from(paid.receipt.pdf_base64,'base64').subarray(0,4).equals(Buffer.from('%PDF')));
 check('5.12 inventory','/audit/v1/inventory/var-jersey-001-M',undefined,{variant_id:'var-jersey-001-M',stock:0,reserved:0});assert.deepEqual(curl('/audit/v1/checkout',order).body,paid);
 const matrix=check('5.13 token matrix','/audit/v1/rbac-matrix',{}, {tokens:{super_admin:T.string,league_organizer:T.string,club_manager:T.string,player:T.string,viewer:T.string},context:{tenant_id:'tenant-alpha',foreign_tenant_id:'tenant-beta',own_league_id:'league-alpha-1',other_league_id:'league-alpha-2',foreign_league_id:'league-beta-1',own_club_id:'club-alpha-1',other_club_id:'club-alpha-2',foreign_club_id:'club-beta-1',own_player_id:'player-alpha-1',other_player_id:'player-alpha-2',foreign_player_id:'player-beta-1'}});
 const probes=[['POST','/audit/v1/rbac/tenants',['super_admin']],['POST','/audit/v1/rbac/leagues/league-alpha-1/fixtures',['super_admin','league_organizer']],['POST','/audit/v1/rbac/clubs/club-alpha-1/roster',['super_admin','club_manager']],['POST','/audit/v1/rbac/clubs/club-alpha-1/products',['super_admin','club_manager']],['PATCH','/audit/v1/rbac/players/player-alpha-1',['super_admin','club_manager','player']],['GET','/audit/v1/rbac/clubs/club-alpha-1',Object.keys(matrix.tokens)],['GET','/audit/v1/rbac/platform/config',['super_admin']]];
 for(const [i,[method,path,allowed]]of probes.entries())for(const [role,token]of Object.entries(matrix.tokens))check(`5.13 P${i+1} ${role}`,path,method==='GET'?undefined:{},allowed.includes(role)?{authorized:true}:error('FORBIDDEN'),allowed.includes(role)?200:403,{method,token});
 for(const [kind,ids]of [['leagues',['league-alpha-2','league-beta-1']],['clubs',['club-alpha-2','club-beta-1']],['players',['player-alpha-2','player-beta-1']]])for(const id of ids){
   const routes=kind==='leagues'?[['POST',`/audit/v1/rbac/leagues/${id}/fixtures`]]:kind==='clubs'?[['POST',`/audit/v1/rbac/clubs/${id}/roster`],['POST',`/audit/v1/rbac/clubs/${id}/products`],['GET',`/audit/v1/rbac/clubs/${id}`]]:[['PATCH',`/audit/v1/rbac/players/${id}`]];
   for(const [method,path]of routes)for(const [role,token]of Object.entries(matrix.tokens)){const allowed=role==='super_admin'||(method==='GET'&&id==='club-alpha-2');check(`5.13 ${role} ${id} ${method}`,path,method==='GET'?undefined:{},allowed?{authorized:true}:error('FORBIDDEN'),allowed?200:403,{method,token});}
 }
 for(const [role,token]of Object.entries(matrix.tokens)){const header=JSON.parse(Buffer.from(token.split('.')[0],'base64url')),claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));records.push({label:'5.13 token lifetime and algorithm '+role,issues:header.alg==='HS256'&&claims.exp-claims.iat>=3600?[]:['JWT algorithm or lifetime differs']});}
 const none=Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')+'.'+matrix.tokens.super_admin.split('.')[1]+'.';check('Appendix C alg:none','/audit/v1/rbac/platform/config',undefined,error('UNAUTHENTICATED'),401,{token:none});
 check('5.14 reset roster scenario','/audit/v1/roster/setup',{...roster,matches_in_progress:[]},{league_id:'lg-r1',status:'configured',squad_counts:{'sq-a':2,'sq-b':0}},201);
 const sync={device_id:'dev-1',actions:[{action_id:'a1',type:'score_event',queued_at:'2026-10-17T11:00:00Z',base_version:0,payload:{event_id:'evt-sync',match_id:'m1',type:'match_start',payload:{}}},{action_id:'a2',type:'roster_transfer',queued_at:'2026-10-17T11:01:00Z',base_version:0,payload:{...transfer,request_id:'tr-sync'}}]};
 const synced=check('5.14 offline sync','/audit/v1/offline-sync',sync,{device_id:'dev-1',results:[{action_id:T.string,status:'applied',resolution:'appended',error_code:null,processed_order:T.integer,server_version:1,signature:v=>v===null||T.hex(v)}],summary:{applied:2,rejected:0,duplicate:0}});assert.deepEqual(synced.results.map(r=>r.processed_order),[1,2]);
 check('5.14 full replay','/audit/v1/offline-sync',sync,{device_id:'dev-1',results:[{action_id:T.string,status:'duplicate',resolution:'skipped_duplicate',error_code:null,processed_order:T.integer,server_version:1,signature:null}],summary:{applied:0,rejected:0,duplicate:2}});
 // Explicit multi-failure probes establish the contract's error precedence.
 check('Error order sports schema before duplicate','/audit/v1/sports',{...sport,name:null},error('VALIDATION_ERROR'),400);
 check('Error order checkout schema before variant','/audit/v1/checkout',{...order,order_id:'bad|id',items:[{variant_id:'missing',quantity:1}]},error('VALIDATION_ERROR'),400);
 check('Error order checkout variant before discount','/audit/v1/checkout',{...order,order_id:'bad-variant',items:[{variant_id:'missing',quantity:1}],discount_code:'missing'},error('VARIANT_NOT_FOUND'),404);
 check('Error order checkout discount before stock','/audit/v1/checkout',{...order,order_id:'bad-discount',discount_code:'missing'},error('INVALID_DISCOUNT_CODE'),400);
 const postPaths=['reset','sports','fixtures','leagues','events','roster/setup','roster/transfer','checkout','rbac-matrix','offline-sync'];
 for(const path of postPaths)check('Appendix C oversized '+path,'/audit/v1/'+path,undefined,error('PAYLOAD_TOO_LARGE'),413,{method:'POST',raw:JSON.stringify({value:'x'.repeat(1048577)})});
 for(const [i,[method,path]]of probes.entries())if(method!=='GET')check('Appendix C oversized authorized P'+(i+1),path,undefined,error('PAYLOAD_TOO_LARGE'),413,{method,token:matrix.tokens.super_admin,raw:JSON.stringify({value:'x'.repeat(1048577)})});
 check('Appendix C hostile sport id','/audit/v1/sports',{...sport,sport_id:"x'; DROP TABLE sports;--"},error('VALIDATION_ERROR'),400);
 const hostile=curl('/audit/v1/checkout',{...order,order_id:'hostile-customer',customer_id:"x';<script>",items:[{variant_id:'var-jersey-001-L',quantity:1}]});records.push({label:'Appendix C hostile customer preserved as plain data',issues:hostile.status===201&&hostile.body.receipt.payload.customer_id==="x';<script>"?[]:['Hostile customer was not preserved']});
 // Signed payloads remain data even when hostile numeric or nesting values are sent.
 check('Hostile non-finite payload','/audit/v1/events',undefined,error('VALIDATION_ERROR'),400,{method:'POST',raw:'{"event_id":"evt-infinity","match_id":"m1","type":"discipline","payload":{"team_id":"t1","points":0,"extra":1e999}}'});
 const deep='{"event_id":"evt-deep","match_id":"m1","type":"discipline","payload":{"team_id":"t1","points":0,"extra":'+ '['.repeat(6000)+'0'+']'.repeat(6000)+'}}';const d=curl('/audit/v1/events',undefined,{method:'POST',raw:deep});records.push({label:'Hostile deep payload never 5xx',status:d.status,issues:d.status>=500?['Deep JSON caused '+d.status]:[]});
 const badQueue=rawEvent=>'{"device_id":"hostile-queue","actions":[{"action_id":"'+JSON.parse(rawEvent).event_id+'","type":"score_event","queued_at":"2026-10-17T11:00:00Z","base_version":1,"payload":'+rawEvent+'}]}';
 const badEvent='{"event_id":"evt-inf-offline","match_id":"m1","type":"discipline","payload":{"team_id":"t1","points":0,"extra":1e999}}';
 const deepEvent=deep.replace('evt-deep','evt-deep-offline');
 const rejectSchema={device_id:'hostile-queue',results:[{action_id:T.string,status:'rejected',resolution:'server_wins',error_code:'VALIDATION_ERROR',processed_order:1,server_version:1,signature:null}],summary:{applied:0,rejected:1,duplicate:0}};
 check('Hostile non-finite offline payload','/audit/v1/offline-sync',undefined,rejectSchema,200,{method:'POST',raw:badQueue(badEvent)});
 check('Hostile deep offline payload','/audit/v1/offline-sync',undefined,rejectSchema,200,{method:'POST',raw:badQueue(deepEvent)});
 const verifyCode="import fs from 'node:fs';import {createHmac} from 'node:crypto';const records=JSON.parse(fs.readFileSync(0,'utf8'));const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);for(const r of records)if(createHmac('sha256',process.env.DAY1_SALT).update(r.id+'|'+canon(r.payload),'utf8').digest('hex')!==r.signature)throw Error('Signature mismatch '+r.id);console.log(records.length+' signatures independently verified');";
 const verified=spawnSync('docker',['compose','exec','-T','backend','node','--input-type=module','-e',verifyCode],{input:JSON.stringify(signed),encoding:'utf8'});records.push({label:'5.3 event and receipt signatures using runtime environment salt',issues:verified.status===0?[]:[verified.stderr]});
 const pdfCode="import fs from 'node:fs';import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';const p=JSON.parse(fs.readFileSync(0,'utf8')),d=await getDocument({data:new Uint8Array(Buffer.from(p.base64,'base64'))}).promise;let t='';for(let i=1;i<=d.numPages;i++)t+=(await(await d.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');if(!t.includes(p.order)||!t.includes('PKR 4500.00'))throw Error('Receipt PDF text mismatch');";
 const pdf=spawnSync('docker',['compose','exec','-T','backend','node','--input-type=module','-e',pdfCode],{input:JSON.stringify({base64:paid.receipt.pdf_base64,order:'ord-001'}),encoding:'utf8'});records.push({label:'5.12 PDF text contains order id and PKR 4500.00',issues:pdf.status===0?[]:[pdf.stderr]});
 // Restore deterministic data before checking the two rate-limit namespaces.
 curl('/audit/v1/reset',{});check('5.13 ping','/api/v1/ping',undefined,{pong:true});
 curl('/audit/v1/reset',{});const burstStart=Date.now();
 const burst=await Promise.all(Array.from({length:150},()=>fetch(base+'/api/v1/ping')));const limited=burst.filter(r=>r.status===429);records.push({label:'Appendix C 150-request rolling rate limit',issues:limited.length>=40&&limited.every(r=>Number(r.headers.get('retry-after'))>=1)?[]:[`Only ${limited.length} rate limits or missing Retry-After`]});
 records.push({label:'Appendix C burst finishes within five seconds',issues:Date.now()-burstStart<5000?[]:['Rate-limit burst exceeded five seconds']});
 for(const response of burst){const body=await response.json();if(response.status===200)assert.deepEqual(body,{pong:true});else assert.equal(differences(body,error('RATE_LIMITED')).length,0);}
 for(let i=0;i<110;i++){const r=curl('/audit/v1/rbac-matrix',{});if(r.status!==200)throw Error('Audit route rate limited');}records.push({label:'Appendix C audit namespace not rate limited',issues:[]});
 await new Promise(resolve=>setTimeout(resolve,11000));check('Appendix C rate recovery after 11 seconds','/api/v1/ping',undefined,{pong:true});
}finally{
 curl('/audit/v1/reset',{});
 writeFileSync(new URL('../../SPEC_CONFORMANCE.json',import.meta.url),JSON.stringify({base_url:base,checked_at:new Date().toISOString(),checks:records.length,mismatches:records.filter(r=>r.issues.length),records},null,2)+'\n');
 console.log('TOTAL',records.length,'MISMATCHES',records.filter(r=>r.issues.length).length);
}
