import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../src/restart-progress.mjs',import.meta.url);
async function module(){assert.ok(existsSync(url),'restart progress reader is not implemented');return import(url);}
const BAKER='tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP';
const BLOCK='B'+'a'.repeat(50);
function fixture(overrides={}){
  const calls=[];const timestamp=new Date().toISOString();
  const fetcher=async(url,options)=>{
    calls.push({url,options});const path=new URL(url).pathname;
    let body;
    if(path.endsWith('/chain_id'))body='NetXdQprcVkpaWU';
    else if(path.endsWith('/head/hash'))body=BLOCK;
    else if(path.endsWith('/header'))body={timestamp};
    else if(path.endsWith('/contracts/'+BAKER+'/balance'))body='383573150';
    else if(path.endsWith('/delegates/'+BAKER+'/own_staked'))body='1';
    else throw new Error('Unexpected RPC fixture path');
    for(const [suffix,value] of Object.entries(overrides))if(path.endsWith(suffix))body=value;
    return{ok:true,status:200,json:async()=>body};
  };
  return{calls,fetcher,timestamp};
}
test('restart funding counts only own liquid plus own stake toward the explicit target',async()=>{
  const m=await module();
  const p=m.calculateProgress({balance:'383573150',ownStaked:'1',externalStaked:'999999999999',totalDelegated:'999999999999'});
  assert.equal(p.currentXTZ,'383.573151');assert.equal(p.goalXTZ,'3,800');
  assert.equal(p.remainingXTZ,'3,416.426849');assert.equal(p.basisPoints,1009);assert.equal(p.percent,'10.09');
  assert.equal(p.goalReached,false);
  for(const bad of [null,undefined,-1,0,false,'-1','0.5','invalid','1'.repeat(21)])assert.throws(()=>m.calculateProgress({balance:bad,ownStaked:'0'}));
});
test('progress handles empty balances and caps the bar without implying baking readiness',async()=>{
  const m=await module();
  assert.equal(m.calculateProgress({balance:'0',ownStaked:'0'}).basisPoints,0);
  const p=m.calculateProgress({balance:'3800000000',ownStaked:'2000000000'});
  assert.equal(p.basisPoints,10000);assert.equal(p.currentXTZ,'5,800');assert.equal(p.remainingXTZ,'0');assert.equal(p.goalReached,true);
  assert.equal(p.bakingReady,undefined);
});
test('public funding reader verifies mainnet and pins all amounts to one fresh block',async()=>{
  const m=await module();const f=fixture();
  const s=await m.readRestartState({fetcher:f.fetcher,pause:async()=>{}});
  assert.equal(s.balance,'383573150');assert.equal(s.ownStaked,'1');assert.equal(s.block,BLOCK);assert.equal(s.timestamp,f.timestamp);
  assert.equal(f.calls.length,5);
  for(const c of f.calls){assert.ok(c.url.startsWith('https://rpc.tzkt.io/mainnet/'));assert.equal(c.options.method,'GET');assert.equal(c.options.credentials,'omit');assert.equal(c.options.redirect,'error');}
  assert.ok(f.calls.filter(c=>c.url.includes('/context/')).every(c=>c.url.includes('/blocks/'+BLOCK+'/')));
  for(const overrides of [{'/chain_id':'NetWrong'},{'/header':{timestamp:'2000-01-01T00:00:00Z'}},{'/balance':null},{'/own_staked':null},{'/head/hash':'invalid'}]){
    await assert.rejects(()=>m.readRestartState({fetcher:fixture(overrides).fetcher,pause:async()=>{}}));
  }
  let attempts=0;
  await assert.rejects(()=>m.readRestartState({pause:async()=>{},fetcher:async()=>{attempts++;return{ok:false,status:429};}}),/rate limit/i);
  assert.equal(attempts,3);
  await assert.rejects(()=>m.readRestartState({pause:async()=>{},fetcher:async()=>({ok:false,status:503})}));
});
test('funding refresh serializes reads and retains last verified data on failure',async()=>{
  const m=await module();let complete,calls=0,failNext=false;
  const controller=m.createFundingController({load:()=>{calls++;if(failNext)throw new Error('offline fixture');return new Promise(resolve=>{complete=resolve;});}});
  const first=controller.refresh();const second=controller.refresh();
  assert.equal(first,second);assert.equal(calls,1);assert.equal(controller.model.busy,true);
  const snapshot={balance:'1000000',ownStaked:'0',timestamp:new Date().toISOString()};complete(snapshot);await first;
  assert.equal(controller.model.snapshot,snapshot);assert.equal(controller.model.error,null);
  failNext=true;await controller.refresh();
  assert.equal(controller.model.snapshot,snapshot);assert.ok(controller.model.error);assert.equal(controller.model.busy,false);
  const failed=m.createFundingController({load:async()=>{throw new Error('offline fixture');}});
  await failed.refresh();assert.equal(failed.model.snapshot,null);assert.equal(failed.model.busy,false);assert.ok(failed.model.error);
});

test('funding UI is full-width, read-only, honest on failure and separate from wallet connection',()=>{
  const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  assert.match(html,/id="restart-funding"/);
  assert.match(html,/<progress[^>]*id="restart-progress"[^>]*max="10000"/);
  assert.match(html,/funding target only/i);
  assert.match(html,/pending exchange withdrawals/i);
  assert.match(html,/src="\.\/restart-ui\.js"/);
  assert.match(html,/id="restart-updated"/);
  assert.match(html,/id="restart-refresh"/);
});
