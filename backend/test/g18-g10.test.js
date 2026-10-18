import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {filterChatMessage} from '../src/chat-filter.js';
import {moderate} from '../src/moderation.js';

for(const value of ['s!c@m','b\u200ea\u200fdword','b\u200ba\u2060dword','b@d_w0rd','p.0.r.n','sh!t','f*u-c.k','a$$h0le']){
  test('G18 live/audit parity: '+JSON.stringify(value),()=>{
    const text=`Watch (${value}), now!`;
    const live=filterChatMessage(text);
    const audit=moderate([{message_id:'m1',sender:'speaker',text}]);
    assert.equal(live.text,'Watch (***), now!');
    assert.equal(live.flagged,true);
    assert.equal(live.dropped,false);
    assert.equal(live.text,audit.filtered_messages[0].text);
    assert.equal(live.reason,audit.filtered_messages[0].reason);
  });
}
test('G18 shared filter preserves clean boundaries and audit flood precedence',()=>{
  for(const text of ['sicam','scamper','assignment','Clean commentary'])assert.deepEqual(filterChatMessage(text),{text,flagged:false,reason:null,dropped:false});
  for(const text of ['AAAA','\n\n\n\n','badword!!!']){
    assert.equal(filterChatMessage(text).dropped,true);
    assert.equal(moderate([{message_id:'m1',sender:'speaker',text}]).filtered_messages.length,0);
  }
});
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
async function call(path,body,method=body===undefined?'GET':'POST',token){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
}
async function openSocket(token){
  const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws/matches/match-m1',token?{headers:{Authorization:`Bearer ${token}`}}:{});
  socket.on('error',()=>{});
  const initial=once(socket,'message',{signal:AbortSignal.timeout(5000)});
  await once(socket,'open',{signal:AbortSignal.timeout(5000)});await initial;return socket;
}
async function upgradeStatus(token){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws/matches/match-m1',{headers:{Authorization:`Bearer ${token}`}});
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('Upgrade rejection timed out'));},5000);
    socket.on('error',()=>{});
    socket.once('unexpected-response',(_request,response)=>{response.resume();clearTimeout(timer);socket.terminate();resolve(response.statusCode);});
    socket.once('open',()=>{clearTimeout(timer);socket.terminate();reject(new Error('Revoked token completed a WebSocket upgrade'));});
  });
}
test('G18 live chat and G10 cross-worker erasure invalidate WS credentials',{skip:process.env.RUN_INTEGRATION!=='1',timeout:45000},async t=>{
  const reset=()=>call('/audit/v1/reset',{});const sockets=[];
  try{
    await reset();
    const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;
    await t.test('G18 actual live chat masks both bypasses and retains audit responses',async()=>{
      for(const [index,text] of ['s!c@m','b\u200ea\u200fdword'].entries()){
        const live=await call('/api/v1/chat',{chat_room_id:'chat-cs-session-101',message_id:`g18-${index}`,text},'POST',tokens.viewer);
        assert.equal(live.status,201,JSON.stringify(live.body));assert.equal(live.body.text,'***');assert.equal(live.body.flagged,true);
        const audit=await call('/audit/v1/moderation/test',{chat_room_id:'chat-cs-session-101',incoming_messages:[{message_id:'m1',sender:'speaker',text}]});
        assert.equal(audit.status,200);assert.equal(audit.body.filtered_messages[0].text,live.body.text);
        assert.deepEqual(Object.keys(audit.body).sort(),['chat_room_id','filtered_messages','kicked_users','muted_users','dlq_status','signature'].sort());
      }
    });
    await t.test('G10 committed erasure closes existing sockets across workers and revoked upgrades return 401',async()=>{
      const affected=await openSocket(tokens.player);sockets.push(affected);
      const unaffected=await openSocket(tokens.viewer);sockets.push(unaffected);
      const anonymous=await openSocket();sockets.push(anonymous);
      const closed=once(affected,'close',{signal:AbortSignal.timeout(5000)});
      // The coverage API owns the socket, while the production process commits erasure.
      const response=await fetch('http://127.0.0.1:8080/audit/v1/privacy/user/player-alpha-1',{method:'DELETE'});
      assert.equal(response.status,200);
      const [code]=await closed;assert.equal(code,1008);
      assert.equal(unaffected.readyState,WebSocket.OPEN);assert.equal(anonymous.readyState,WebSocket.OPEN);
      assert.equal(await upgradeStatus(tokens.player),401);
      assert.equal((await call('/api/v1/me',undefined,'GET',tokens.player)).status,401);
    });
  }finally{for(const socket of sockets)socket.terminate();await reset();}
});
