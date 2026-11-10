import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {apply} from './index.js'
function fixture(config={}, agents) {
 const routes=new Map(),cleanups=[];let hook,saved
 const ctx={fiber:{entry:{}},logger:{info(){}},llm:{listProviders:()=>[]},agentDefaultModel:{currentSelection:()=>({})},get:(name)=>name==='configEditor'?({edit:async(_,change)=>{saved=change({},{})}}):name==='agents'?agents:undefined,on:(name,fn)=>{hook=fn},effect:fn=>cleanups.push(fn()),webServer:{register:r=>{assert.ok(!routes.has(r.path));routes.set(r.path,r);return()=>routes.delete(r.path)}}}
 apply(ctx,config)
 return {routes,cleanups,get saved(){return saved},hook}
}
async function post(f,path,body){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={host:'127.0.0.1:10310','content-type':'application/json'};req.socket={remoteAddress:'127.0.0.1'};let code,result;const res={writeHead(c){code=c},end(s){result=JSON.parse(s)}};await f.routes.get('/api/llm-concurrency/'+path).handler(req,res);return {code,result}}
test('current session selection changes without a new LLM request',async()=>{
 let provider='first';const f=fixture({}, {get:id=>id==='s'?{model:{current:()=>({provider,model:'m'})}}:undefined});
 const get=async(id)=>{let result;await f.routes.get('/api/llm-concurrency/config').handler({method:'GET',url:'/?sessionId='+id,headers:{host:'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}},{writeHead(){},end(s){result=JSON.parse(s)}});return result.data.effectiveProvider};
 assert.equal(await get('s'),'first');provider='second';assert.equal(await get('s'),'second');assert.equal(await get('unknown'),null)
})
test('save uses config editor and preserves removed provider rules',async()=>{
 const f=fixture({providers:{old:3}});const r=await post(f,'config/update',{providers:{}});assert.equal(r.code,200);assert.deepEqual(f.saved.providers,{});
 for(const dispose of f.cleanups) dispose();assert.equal(f.routes.size,0)
})
test('HTTP rejects cross-origin, remote peers and incorrect methods',async()=>{
 const f=fixture();
 for(const patch of [{method:'GET'},{socket:{remoteAddress:'192.168.1.2'}},{headers:{host:'127.0.0.1:10310',origin:'https://evil.example','content-type':'application/json'}}]) {
  const req=Object.assign(Readable.from([]),{method:'POST',headers:{host:'127.0.0.1:10310','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}},patch);let status;
  await f.routes.get('/api/llm-concurrency/config/update').handler(req,{writeHead(c){status=c},end(){}});assert.ok([403,405].includes(status));assert.equal(f.saved,undefined)
 }
})
test('invalid session limits do not succeed',async()=>{const f=fixture();for(const limit of [-1,1.5,'3']) {const r=await post(f,'session-override',{sessionId:'s',limit});assert.equal(r.result.ok,false)}})
test('session override constrains only its own session',async()=>{
 const f=fixture({providers:{p:5},models:{},verbose:false});await post(f,'session-override',{sessionId:'a',limit:1});
 const stream=s=>f.hook({provider:'p',model:'m',sessionId:s},async function*(){yield {type:'text-delta',text:'x'}});
 const a=stream('a'),a2=stream('a'),b=stream('b');await a.next();let started=false;const waiting=a2.next().then(()=>{started=true});await b.next();await new Promise(r=>setImmediate(r));assert.equal(started,false);await a.return();await waiting;await a2.return();await b.return()
})
test('provider and model constraints both apply under concurrent load',async()=>{
 const f=fixture({providers:{p:3},models:{'p/m':2},verbose:false});let active=0,peak=0;
 const run=async()=>{for await(const chunk of f.hook({provider:'p',model:'m'},async function*(){active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,3));yield {type:'text-delta',text:'x'}}finally{active--}})) {}}
 await Promise.all(Array.from({length:20},run));assert.equal(peak,2);assert.equal(active,0)
})
test('stream hook enforces provider limit and releases on return',async()=>{
 const f=fixture({providers:{p:1},verbose:false});const opts={provider:'p',model:'m',sessionId:'s'};let started=0;
 async function* next(){started++;yield {type:'text-delta',text:'test'}}
 const a=f.hook(opts,next),b=f.hook(opts,next);await a.next();let bStarted=false;const bp=b.next().then(v=>{bStarted=true;return v});await new Promise(r=>setImmediate(r));assert.equal(started,1);assert.equal(bStarted,false);
 const save=await post(f,'config/update',{providers:{}});assert.equal(save.code,409);assert.equal(f.saved,undefined);
 await a.return();await bp;assert.equal(started,2);await b.return()
})
