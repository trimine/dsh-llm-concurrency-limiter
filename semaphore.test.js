import {test} from 'node:test'
import assert from 'node:assert/strict'
import {AsyncSemaphore, validateConfig} from './index.js'
test('configuration validation preserves explicit empty rules and rejects malformed limits',()=>{
 assert.deepEqual(validateConfig({providers:{},globalConcurrency:0}),{providers:{},globalConcurrency:null})
 for(const bad of [{providers:[]},{providers:{x:1.5}},{defaultProviderConcurrency:NaN},{globalConcurrency:-1},{unknown:1}]) assert.throws(()=>validateConfig(bad))
 const original={providers:{x:2}};const checked=validateConfig(original);checked.providers.x=3;assert.equal(original.providers.x,2)
})
test('unload rejects waiters and permits in-flight release',async()=>{
 const s=new AsyncSemaphore('test',1,{verbose:false});await s.acquire();const waiter=s.acquire();const rejection=assert.rejects(waiter,{code:'LIMITER_DISPOSED'});s.dispose();await rejection;assert.equal(s.queueLength,0);await assert.rejects(s.acquire(),{code:'LIMITER_DISPOSED'});s.release();assert.equal(s.active,0)
})
const tick=()=>new Promise(r=>setImmediate(r))
test('lowering limit neither loses active counts nor starts queued work',async()=>{
 const s=new AsyncSemaphore('test',3,{verbose:false}); await Promise.all([s.acquire(),s.acquire(),s.acquire()]);
 let started=false; const p=s.acquire().then(()=>{started=true}); s.updateLimit(1); await tick();
 assert.equal(s.active,3);assert.equal(started,false);
 s.release();s.release();await tick();assert.equal(s.active,1);assert.equal(started,false);
 s.release();await p;assert.equal(s.active,1);s.release();assert.equal(s.active,0)
})
test('raising idle limit never decrements active',async()=>{
 const s=new AsyncSemaphore('test',2);await s.acquire();s.updateLimit(3);assert.equal(s.active,1);s.release();assert.equal(s.active,0)
})
test('raising limit fills only newly available slots',async()=>{
 const s=new AsyncSemaphore('test',1,{verbose:false});await s.acquire();const a=s.acquire(),b=s.acquire();s.updateLimit(3);await Promise.all([a,b]);assert.equal(s.active,3);s.release();s.release();s.release();assert.equal(s.active,0)
})
test('cancelled waiter is removed without consuming a slot',async()=>{
 const s=new AsyncSemaphore('test',1,{verbose:false});await s.acquire();const c=new AbortController();const p=s.acquire(c.signal);c.abort();await assert.rejects(p);assert.equal(s.queueLength,0);assert.equal(s.active,1);s.release()
})
test('timeout and queue capacity reject without corrupting accounting',async()=>{
 const s=new AsyncSemaphore('test',1,{verbose:false,maxQueueSize:1,queueTimeoutMs:10});await s.acquire();const p=s.acquire();const rejected=assert.rejects(p,{code:'TIMEOUT'});await assert.rejects(s.acquire(),{code:'QUEUE_FULL'});await rejected;assert.equal(s.active,1);assert.equal(s.queueLength,0);s.release()
})
