import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../src/delegation-controller.mjs',import.meta.url);
const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
const baker='tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP';
async function setup(){
  assert.ok(existsSync(url),'delegation controller is not implemented');
  const {createController}=await import(url);
  const account={address,network:{type:'mainnet'},scopes:['operation_request']};
  let active=account,loadCount=0,permission=null,disconnects=0;
  const operations=[];
  const client={requestPermissions:async p=>{permission=p;},getActiveAccount:async()=>active,
    requestOperation:async p=>{operations.push(p);return{transactionHash:'o'+'a'.repeat(50)};},
    disconnect:async()=>{disconnects++;active=null;}};
  let staked='0';
  const controller=createController({client,loadState:async()=>{
    loadCount++; return{address,network:'mainnet',chainId:'NetXdQprcVkpaWU',balance:'1000000',
      staked,unstakedFrozen:'0',delegate:null,observedAt:Date.now(),bakerDeactivated:true};
  }});
  return {controller,operations,client,setStake:x=>{staked=x;},setActive:x=>{active=x;},account,
    get permission(){return permission;},get disconnects(){return disconnects;},get loads(){return loadCount;}};
}
test('connect and review never send operations; explicit confirmation sends exactly one delegation',async()=>{
  const x=await setup();
  await x.controller.connect();
  assert.deepEqual(x.permission,{scopes:['operation_request']});
  assert.equal(x.operations.length,0);
  assert.throws(()=>x.controller.review(false));
  x.controller.review(true);
  assert.equal(x.operations.length,0);
  await x.controller.submit(true);
  assert.equal(x.operations.length,1);
  assert.deepEqual(x.operations[0],{operationDetails:[{kind:'delegation',source:address,delegate:baker}]});
  assert.equal(x.controller.model.hash,'o'+'a'.repeat(50));
  assert.ok(x.loads>=2);
  await x.controller.disconnect();
  assert.equal(x.disconnects,1);
  assert.equal(x.controller.model.account,null);
});
test('changed stake or wallet after review cannot reach requestOperation',async()=>{
  for(const changed of ['stake','account']){
    const x=await setup();await x.controller.connect();x.controller.review(true);
    if(changed==='stake')x.setStake('1');
    else x.setActive({...x.account,address:baker});
    await assert.rejects(()=>x.controller.submit(true));
    assert.equal(x.operations.length,0);
  }
});
test('final awaited account read cannot submit stale state or an invalidated review',async t=>{
  for(const scenario of ['stale snapshot','expired review','cancelled review']){
    await t.test(scenario,async t=>{
      let now=1000000;
      t.mock.method(Date,'now',()=>now);
      const x=await setup();await x.controller.connect();x.controller.review(true);
      if(scenario==='expired review')now+=119000;
      let reads=0,operationCalls=0;
      x.client.getActiveAccount=async()=>{
        if(++reads===2){
          await Promise.resolve();
          if(scenario==='stale snapshot')now+=121000;
          else if(scenario==='expired review')now+=2000;
          else x.controller.cancelReview();
        }
        return x.account;
      };
      // Non-signing fixture: count requests without using a wallet or network.
      x.client.requestOperation=async()=>{
        operationCalls++;return{transactionHash:'o'+'a'.repeat(50)};
      };
      let failure;
      try{await x.controller.submit(true);}catch(error){failure=error;}
      assert.equal(reads,2,'the final awaited account read must be reached');
      assert.equal(operationCalls,0,'no operation may be requested after the final account read invalidates state or review');
      assert.match(failure?.message??'',scenario==='stale snapshot'?/stale/:/Review a fresh delegation/);
      assert.equal(x.controller.model.review,null);
      assert.equal(x.controller.model.uncertain,false);
      assert.equal(x.controller.model.busy,false);
    });
  }
});
test('wallet failures are not retried and ambiguous outcomes block another attempt',async()=>{
  const x=await setup();await x.controller.connect();x.controller.review(true);
  let calls=0;x.client.requestOperation=async()=>{calls++;throw new Error('wallet timeout fixture');};
  await assert.rejects(()=>x.controller.submit(true));
  assert.equal(calls,1);
  assert.equal(x.controller.model.uncertain,true);
  assert.throws(()=>x.controller.review(true));
});
