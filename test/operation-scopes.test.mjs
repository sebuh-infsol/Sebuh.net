import test from 'node:test';
import assert from 'node:assert/strict';
import {BAKER,CHAIN,buildDelegationRequest} from '../src/delegation-core.mjs';
import {buildDonationRequest} from '../src/donation-core.mjs';
import {createController} from '../src/delegation-controller.mjs';

const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
const account=()=>({address,network:{type:'mainnet'},scopes:['operation_request']});
const state=()=>({address,network:'mainnet',chainId:CHAIN,balance:'2000000000',staked:'0',unstakedFrozen:'0',delegate:null,observedAt:Date.now()});
// Deliberately require exactly one grant: duplicate operation_request is rejected.
const invalidScopes=[
  ...['sign','threshold','encrypt','notification','unknown'].map(scope=>[scope,['operation_request',scope]]),
  ['absent',undefined],['null',null],['empty',[]],['string','operation_request'],
  ['missing operation',['threshold']],['duplicate',['operation_request','operation_request']],
  ['null entry',['operation_request',null]],['object entry',['operation_request',{}]],
  ['number entry',['operation_request',1]],['undefined entry',['operation_request',undefined]],
  ['sparse',Array(1)],['nested',[['operation_request']]],['wrong case',['OPERATION_REQUEST']]
];

function fixture(){
  let active=account();const operations=[],permissions=[];
  const client={async requestPermissions(p){permissions.push(p);},async getActiveAccount(){return active;},async requestOperation(p){operations.push(p);return {transactionHash:'o'+'a'.repeat(50)};}};
  const controller=createController({client,loadState:async()=>state()});
  return {client,controller,operations,permissions,setScopes(scopes){active={...account(),scopes};}};
}
const review=(controller,kind)=>kind==='donation'?controller.reviewDonation('10',true):controller.review(true);
const submit=(controller,kind)=>kind==='donation'?controller.submitDonation(true):controller.submit(true);

test('controller rejects non-exact grants at connect, review and each submission account read without operations',async t=>{
  for(const [label,scopes] of invalidScopes)for(const kind of ['donation','delegation']){
    await t.test(`${kind}: ${label}: initially granted`,async()=>{
      const x=fixture();x.setScopes(scopes);
      await assert.rejects(()=>x.controller.connect(),/operation permission only/);
      assert.throws(()=>review(x.controller,kind));
      await assert.rejects(()=>submit(x.controller,kind));
      assert.deepEqual(x.permissions,[{scopes:['operation_request']}]);
      assert.equal(x.operations.length,0);
    });
    await t.test(`${kind}: ${label}: invalid at review`,async()=>{
      const x=fixture();await x.controller.connect();x.controller.model.account.scopes=scopes;
      assert.throws(()=>review(x.controller,kind),/operation-only/);
      await assert.rejects(()=>submit(x.controller,kind));assert.equal(x.operations.length,0);
    });
    for(const changedRead of [1,2])await t.test(`${kind}: ${label}: changed after review at read ${changedRead}`,async()=>{
      const x=fixture();await x.controller.connect();review(x.controller,kind);
      let reads=0;x.client.getActiveAccount=async()=>{
        await Promise.resolve();
        return {...account(),scopes:++reads===changedRead?scopes:['operation_request']};
      };
      await assert.rejects(()=>submit(x.controller,kind),/operation permission only/);
      assert.equal(reads,changedRead);assert.equal(x.operations.length,0);
      assert.equal(x.controller.model.review,null);assert.equal(x.controller.model.donationReview,null);
    });
  }
});

test('donation builder rejects every non-exact operation-only grant',async t=>{
  for(const [label,scopes] of invalidScopes)await t.test(label,()=>{
    assert.throws(()=>buildDonationRequest({account:{...account(),scopes},state:state(),amountXTZ:'10',acknowledged:true,reviewed:true}),/operation-only/);
  });
  assert.deepEqual(buildDonationRequest({account:account(),state:state(),amountXTZ:'10',acknowledged:true,reviewed:true}),{operationDetails:[{kind:'transaction',source:address,destination:BAKER,amount:'10000000'}]});
});

test('delegation builder rejects every non-exact operation-only grant',async t=>{
  for(const [label,scopes] of invalidScopes)await t.test(label,()=>{
    assert.throws(()=>buildDelegationRequest({account:{...account(),scopes},state:state(),acknowledged:true,reviewed:true}),/operation-only/);
  });
  assert.deepEqual(buildDelegationRequest({account:account(),state:state(),acknowledged:true,reviewed:true}),{operationDetails:[{kind:'delegation',source:address,delegate:BAKER}]});
});
