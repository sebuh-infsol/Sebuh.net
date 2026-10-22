import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../src/delegation-controller.mjs';
import {BAKER,CHAIN} from '../src/delegation-core.mjs';
const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
async function setup(){
  const account={address,network:{type:'mainnet',chainId:'tezos:NetXdQprcVkpaWU'},scopes:['operation_request']};
  let active=account,loads=0;
  const operations=[];
  const state={address,network:'mainnet',chainId:CHAIN,balance:'2000000000',staked:'0',unstakedFrozen:'0',delegate:null};
  const client={requestPermissions:async p=>assert.deepEqual(p,{scopes:['operation_request'],networks:[{chainId:'tezos:NetXdQprcVkpaWU'}]}),getActiveAccount:async()=>active,disconnect:async()=>{},requestOperation:async p=>{operations.push(p);return {transactionHash:'o'+'a'.repeat(50)};}};
  const controller=createController({client,loadState:async()=>{loads++;return {...state,observedAt:Date.now()};}});
  return {account,client,controller,state,operations,setActive:a=>active=a,get loads(){return loads;}};
}
test('review lifecycle is mutually exclusive, cancellable and cleared by connection actions',async()=>{
  const x=await setup();await x.controller.connect();
  x.controller.review(true);x.controller.reviewDonation('10',true);assert.equal(x.controller.model.review,null);
  x.controller.review(true);assert.equal(x.controller.model.donationReview,null);
  for(const action of ['cancelReview','cancelDonationReview','refresh','connect','disconnect']){
    if(!x.controller.model.account)await x.controller.connect();
    x.controller.reviewDonation('10',true);await x.controller[action]();assert.equal(x.controller.model.donationReview,null,action);
  }
});
test('final awaited account read cannot bypass donation review identity, binding or expiry',async t=>{
  for(const scenario of ['stale','expired','cancelled','replaced','amount','mutez','source','destination','createdAt','account','scopes','network','unacked'])await t.test(scenario,async t=>{
    let now=1000000;t.mock.method(Date,'now',()=>now);
    const x=await setup();await x.controller.connect();x.controller.reviewDonation('10',true);
    let reads=0;
    x.client.getActiveAccount=async()=>{
      if(++reads===2){
        await Promise.resolve();
        const r=x.controller.model.donationReview;
        if(scenario==='stale')now+=120001;
        if(scenario==='expired')r.createdAt=now-120001;
        if(scenario==='cancelled')x.controller.cancelReview();
        if(scenario==='replaced')x.controller.model.donationReview={...r};
        if(scenario==='amount')r.amountXTZ='100';
        if(scenario==='mutez')r.amountMutez='100000000';
        if(scenario==='source')r.source=BAKER;
        if(scenario==='destination')r.destination=address;
        if(scenario==='createdAt')r.createdAt=NaN;
        if(scenario==='account')return {...x.account,address:BAKER};
        if(scenario==='scopes')return {...x.account,scopes:['operation_request','sign']};
        if(scenario==='network')return {...x.account,network:{type:'ghostnet'}};
      }
      return x.account;
    };
    await assert.rejects(()=>x.controller.submitDonation(scenario!=='unacked'),undefined,scenario);
    assert.equal(reads,2);assert.equal(x.operations.length,0);assert.equal(x.controller.model.donationReview,null);assert.equal(x.controller.model.uncertain,false);
  });
});
test('changed permission scopes cannot reuse a reviewed donation',async()=>{
  const x=await setup();await x.controller.connect();x.controller.reviewDonation('10',true);
  x.setActive({...x.account,scopes:['operation_request','threshold']});
  await assert.rejects(()=>x.controller.submitDonation(true));assert.equal(x.operations.length,0);
});
test('shared lock rejects duplicate and mixed operation kinds in both directions',async()=>{
  for(const kind of ['donation','delegation']){
    const x=await setup();await x.controller.connect();
    if(kind==='donation')x.controller.reviewDonation('10',true);else x.controller.review(true);
    let release,entered;const started=new Promise(resolve=>entered=resolve);
    x.client.requestOperation=async p=>{x.operations.push(p);entered();await new Promise(resolve=>release=resolve);return {transactionHash:'o'+'a'.repeat(50)};};
    const pending=kind==='donation'?x.controller.submitDonation(true):x.controller.submit(true);
    await started;
    await assert.rejects(()=>x.controller.submitDonation(true),/pending/);await assert.rejects(()=>x.controller.submit(true),/pending/);
    assert.throws(()=>x.controller.review(true));assert.throws(()=>x.controller.reviewDonation('10',true));
    release();await pending;assert.equal(x.operations.length,1);
  }
});
test('rejected and malformed donation responses never retry and block both operation kinds',async()=>{
  for(const response of ['reject',undefined,null,{}, {transactionHash:'bad'}]){
    const x=await setup();await x.controller.connect();x.controller.reviewDonation('10',true);
    let calls=0;x.client.requestOperation=async()=>{calls++;if(response==='reject')throw new Error('fixture rejection');return response;};
    await assert.rejects(()=>x.controller.submitDonation(true),/No automatic retry/);
    assert.equal(calls,1);assert.equal(x.controller.model.uncertain,true);
    assert.throws(()=>x.controller.review(true));assert.throws(()=>x.controller.reviewDonation('10',true));
    await assert.rejects(()=>x.controller.submit(true));await assert.rejects(()=>x.controller.submitDonation(true));assert.equal(calls,1);
  }
});
test('donations allow current baker delegation and other locked funds but use liquid balance only',async()=>{
  const x=await setup();await x.controller.connect();x.state.delegate=BAKER;x.state.staked='900000000';x.state.unstakedFrozen='100000000';
  await x.controller.refresh();x.controller.reviewDonation('10',true);await x.controller.submitDonation(true);assert.equal(x.operations.length,1);
  for(const balance of ['10000000','9999999']){
    const y=await setup();await y.controller.connect();y.controller.reviewDonation('10',true);y.state.balance=balance;y.state.staked='99999999999999999999';
    await assert.rejects(()=>y.controller.submitDonation(true),/liquid balance/);assert.equal(y.operations.length,0);
  }
});
test('changed account before fresh loading and expired review cannot send a donation',async t=>{
  const x=await setup();await x.controller.connect();x.controller.reviewDonation('10',true);x.setActive({...x.account,address:BAKER});
  const loads=x.loads;await assert.rejects(()=>x.controller.submitDonation(true));assert.equal(x.loads,loads);assert.equal(x.operations.length,0);
  let now=1000000;t.mock.method(Date,'now',()=>now);
  const y=await setup();await y.controller.connect();y.controller.reviewDonation('10',true);now+=119000;
  let reads=0;y.client.getActiveAccount=async()=>{if(++reads===2){await Promise.resolve();now+=2000;}return y.account;};
  await assert.rejects(()=>y.controller.submitDonation(true),/fresh donation/);assert.equal(y.operations.length,0);
});
test('delegation uncertainty also blocks donation and refresh cannot clear the shared safety stop',async()=>{
  const x=await setup();await x.controller.connect();x.controller.review(true);
  let calls=0;x.client.requestOperation=async()=>{calls++;throw new Error('fixture timeout');};
  await assert.rejects(()=>x.controller.submit(true));assert.equal(x.controller.model.uncertain,true);
  await x.controller.refresh();assert.throws(()=>x.controller.reviewDonation('10',true));
  await assert.rejects(()=>x.controller.submitDonation(true));assert.equal(calls,1);
});
test('donation connect and review are non-operating; canonical review requires consent and final approval sends exact preset amounts',async()=>{
  for(const amount of ['10','100','1000','0.000001']){
    const x=await setup();await x.controller.connect();
    assert.equal(x.controller.model.donationReview,null);
    assert.throws(()=>x.controller.reviewDonation(amount,false));
    const loads=x.loads;x.controller.reviewDonation('000'+amount,true);
    assert.equal(x.loads,loads);assert.equal(x.operations.length,0);
    const r=x.controller.model.donationReview;
    assert.equal(r.source,address);assert.equal(r.destination,BAKER);assert.equal(r.amountXTZ,amount);assert.equal(typeof r.createdAt,'number');
    await x.controller.submitDonation(true);
    assert.deepEqual(x.operations,[{operationDetails:[{kind:'transaction',source:address,destination:BAKER,amount:amount==='0.000001'?'1':amount+'000000'}]}]);
    assert.equal(x.controller.model.hash,'o'+'a'.repeat(50));assert.equal(x.controller.model.donationReview,null);
    assert.throws(()=>x.controller.review(true));assert.throws(()=>x.controller.reviewDonation('10',true));
  }
});
