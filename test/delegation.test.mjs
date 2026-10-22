import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const moduleUrl = new URL('../src/delegation-core.mjs', import.meta.url);
const SOURCE = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
const TARGET = 'tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP';

async function core() {
  assert.ok(existsSync(moduleUrl), 'delegation safety module not implemented');
  return import(moduleUrl);
}
function state() {
  return { address:SOURCE, network:'mainnet', chainId:'NetXdQprcVkpaWU',
    balance:'1000000', staked:'0', unstakedFrozen:'0', delegate:null,
    observedAt:Date.now(), bakerDeactivated:true };
}

test('only explicit, acknowledged mainnet delegation can reach the wallet', async () => {
  const m = await core();
  const s = state();
  const account = {address:SOURCE, network:{type:'mainnet',chainId:'tezos:NetXdQprcVkpaWU'}, scopes:['operation_request']};
  assert.deepEqual(m.buildDelegationRequest({account, state:s, acknowledged:true, reviewed:true}), {
    operationDetails:[{kind:'delegation',source:SOURCE,delegate:TARGET}]
  });
  for (const [name,patch] of Object.entries({
    'no disclosure consent':{acknowledged:false},
    'no review':{reviewed:false},
    'account changed':{account:{...account,address:TARGET}},
    'wrong network':{account:{...account,network:{type:'shadownet'}}},
    'missing operation permission':{account:{...account,scopes:[]}},
    'broader signing permission':{account:{...account,scopes:['operation_request','sign']}},
    'staked funds':{state:{...s,staked:'1'}},
    'pending frozen funds':{state:{...s,unstakedFrozen:'1'}},
    'already delegated':{state:{...s,delegate:TARGET}},
    'no fee balance':{state:{...s,balance:'0'}},
    'stale snapshot':{state:{...s,observedAt:Date.now()-120001}},
    'wrong chain':{state:{...s,chainId:'NetOther'}},
  })) {
    assert.throws(()=>m.buildDelegationRequest({account,state:s,acknowledged:true,reviewed:true,...patch}),undefined,name);
  }
});

test('null stake on an undelegated account is supported without weakening amount validation',async()=>{
  const m=await core();
  const values={balance:'1',staked_balance:null,unstaked_frozen_balance:'0',delegate:null};
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    const field=path.split('/').at(-1);
    let body;
    if(field==='chain_id')body='NetXdQprcVkpaWU';
    else if(field==='hash')body='B'+'a'.repeat(50);
    else if(field==='header')body={timestamp:new Date().toISOString()};
    else if(path.includes('/context/delegates/'))body={deactivated:true};
    else if(Object.hasOwn(values,field)){
      body=values[field];
      if(field==='delegate' && body===null)return{ok:false,status:404};
    }else throw new Error('Unexpected fixture path');
    return{ok:true,status:200,json:async()=>body};
  };
  const read=()=>m.readAccountState(SOURCE,{fetcher,pause:async()=>{}});
  const result=await read();
  assert.equal(result.balance,'1');
  assert.equal(result.staked,'0');
  assert.equal(result.delegate,null);
  for(const field of ['balance','unstaked_frozen_balance']){
    const previous=values[field];values[field]=null;
    await assert.rejects(read,/Invalid balance data/);values[field]=previous;
  }
  for(const invalid of [undefined,0,false,'invalid']){
    values.staked_balance=invalid;await assert.rejects(read,/Invalid balance data/);
  }
  values.staked_balance=null;values.delegate=TARGET;
  await assert.rejects(read,/Invalid balance data/,'null stake with a delegate is inconsistent and must not be treated as zero');
});

test('public RPC reads are pinned to one fresh mainnet block and fail closed', async () => {
  const m = await core();
  assert.equal(typeof m.readAccountState,'function','read-only RPC state loader not implemented');
  const paths=[];
  const blockTimestamp=new Date(Date.now()-45000).toISOString();
  const fetcher=async(url,options)=>{
    paths.push(url);
    assert.equal(options.credentials,'omit');
    const path=new URL(url).pathname;
    let body;
    if(path.endsWith('/chain_id')) body='NetXdQprcVkpaWU';
    else if(path.endsWith('/head/hash')) body='B'+'a'.repeat(50);
    else if(path.endsWith('/header')) body={timestamp:blockTimestamp};
    else if(path.endsWith('/staked_balance')) body='0';
    else if(path.endsWith('/unstaked_frozen_balance')) body='0';
    else if(path.endsWith('/balance')) body='1000000';
    else if(path.endsWith('/delegate')) return {ok:false,status:404};
    else if(path.endsWith('/delegates/'+TARGET)) body={deactivated:true};
    else throw new Error('Unexpected test URL '+url);
    return {ok:true,status:200,json:async()=>body};
  };
  const result=await m.readAccountState(SOURCE,{fetcher,pause:async()=>{}});
  assert.equal(result.address,SOURCE);
  assert.equal(result.delegate,null);
  assert.equal(result.staked,'0');
  assert.equal(result.bakerDeactivated,true);
  assert.equal(result.observedAt,Date.parse(blockTimestamp),'freshness must age from the pinned block, not completion of slow RPC reads');
  assert.ok(paths.every(p=>p.startsWith('https://rpc.tzkt.io/mainnet/')));
  assert.ok(paths.filter(p=>p.includes('/context/')).every(p=>p.includes('/blocks/B'+'a'.repeat(50)+'/')));
  await assert.rejects(()=>m.readAccountState(SOURCE,{fetcher:async()=>({ok:false,status:503})}));
  await assert.rejects(()=>m.readAccountState(SOURCE,{fetcher:async()=>({ok:true,json:async()=> 'NetWrong'})}));
  let limitedCalls=0;
  await assert.rejects(()=>m.readAccountState(SOURCE,{pause:async()=>{},fetcher:async()=>{
    limitedCalls++; return {ok:false,status:429,headers:{get:()=>null}};
  }}));
  assert.equal(limitedCalls,3,'read-only 429 handling must retry within a fixed bound');
});
