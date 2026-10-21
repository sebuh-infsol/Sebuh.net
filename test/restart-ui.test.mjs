import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {calculateProgress,createFundingController} from '../src/restart-progress.mjs';

// Execute the actual UI with its real controller. Only DOM, time and the
// public-data load boundary are controlled; no network or wallet is available.
function ui(){
  let now=Date.parse('2026-10-20T12:00:00Z'),nextTimer=0;
  const timers=new Map(),elements=new Map(),requests=[],listeners=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      hidden:false,disabled:false,textContent:'',attributes:{},listeners:new Map(),
      setAttribute(name,value){this.attributes[name]=value;},
      addEventListener(name,fn){this.listeners.set(name,fn);}
    });
    return elements.get(id);
  };
  const document={hidden:false,getElementById:element,
    addEventListener(name,fn){listeners.set(name,fn);}};
  class ClockDate extends Date{static now(){return now;}}
  function schedule(fn,delay,interval=false){
    const id=++nextTimer;timers.set(id,{fn,at:now+delay,delay,interval});return id;
  }
  const source=readFileSync(new URL('../src/restart-ui.mjs',import.meta.url),'utf8');
  assert.match(source,/^import .* from '\.\/restart-progress\.mjs';\n/);
  runInNewContext(source.replace(/^import .*\n/,''),{
    document,Date:ClockDate,calculateProgress,
    createFundingController:options=>createFundingController({...options,load:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}),
    setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>schedule(fn,delay,true)
  },{filename:'restart-ui.mjs'});
  const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
  return{
    element,requests,document,flush,
    snapshot:(age=0,overrides={})=>({balance:'1000000',ownStaked:'0',timestamp:new Date(now-age).toISOString(),...overrides}),
    async accept(snapshot){requests.at(-1).resolve(snapshot);await flush();},
    async fail(){requests.at(-1).reject(new Error('offline fixture'));await flush();},
    click(){element('restart-refresh').listeners.get('click')();},
    visibility(hidden){document.hidden=hidden;listeners.get('visibilitychange')();},
    jump(ms){now+=ms;}, // Simulate suspended/throttled timers.
    advance(ms){
      const end=now+ms;
      while(true){
        const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        const [id,timer]=next;now=timer.at;
        if(timer.interval)timer.at+=timer.delay;else timers.delete(id);
        timer.fn();
      }
      now=end;
    }
  };
}
function assertLastVerified(h){
  assert.equal(h.element('restart-progress').hidden,true,'unverified progress must stay hidden');
  assert.match(h.element('restart-updated').textContent,/^Last verified:/);
  assert.match(h.element('restart-data-status').textContent,/last verified/i);
  assert.equal(h.element('restart-current').textContent,'1 XTZ');
}

test('funding reads once per page load and never polls or refreshes on tab return',async()=>{
  const h=ui();await h.accept(h.snapshot());
  h.advance(600000);h.visibility(true);h.visibility(false);
  assert.equal(h.requests.length,1,'time and tab visibility must not generate RPC reads');
  h.click();assert.equal(h.requests.length,2,'manual Refresh remains deliberate');
});

test('actual UI independently expires an accepted 119-second-old snapshot within two seconds',async()=>{
  const h=ui();await h.accept(h.snapshot(119000));
  assert.equal(h.element('restart-progress').hidden,false);
  h.advance(1000);
  assert.equal(h.element('restart-progress').hidden,false,'the inclusive 120-second boundary is still accepted');
  h.advance(1);
  assertLastVerified(h);
  h.advance(999);
  assertLastVerified(h);
  assert.equal(h.requests.length,1,'expiry must not require a fetch');
});

test('actual UI reevaluates visibility return without a fetch being due or timers firing',async()=>{
  const h=ui();await h.accept(h.snapshot(119000));
  h.visibility(true);
  h.jump(2000);
  assert.equal(h.element('restart-progress').hidden,false,'simulate a suspended expiry timer');
  h.visibility(false);
  assertLastVerified(h);
  assert.equal(h.requests.length,1,'last attempt was only two seconds ago');
});

test('actual UI retains failure through pending retries until a new validated success',async()=>{
  const h=ui();await h.accept(h.snapshot());
  assert.equal(h.element('restart-progress').hidden,false);
  h.click();await h.fail();
  assertLastVerified(h);
  h.click();
  assert.equal(h.element('restart-refresh').disabled,true);
  assertLastVerified(h);
  await h.fail();
  assertLastVerified(h);
  h.click();
  assertLastVerified(h);
  await h.accept(h.snapshot(0,{balance:'invalid'}));
  assertLastVerified(h);
  h.click();
  assertLastVerified(h);
  await h.accept(h.snapshot(0,{balance:'2000000'}));
  assert.equal(h.element('restart-progress').hidden,false);
  assert.equal(h.element('restart-current').textContent,'2 XTZ');
  assert.match(h.element('restart-updated').textContent,/^Block time:/);
  assert.match(h.element('restart-data-status').textContent,/^Verified read-only/);
  assert.equal(h.element('restart-refresh').disabled,false);
});
