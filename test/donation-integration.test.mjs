import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNetworkState} from '../src/network-state.mjs';
import {createController} from '../src/delegation-controller.mjs';
import {BAKER,CHAIN,buildDelegationRequest} from '../src/delegation-core.mjs';

// Actual UI, actual controller and actual cores; only client/state/DOM are fake.
// No SDK import, wallet, signing capability, RPC or other network is provided.
function integratedUI(){
  const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
  const elements=new Map(),operations=[],permissions=[];
  let controller,loads=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,value:id==='donation-amount'?'10':'',textContent:'',checked:false,disabled:false,hidden:false,dataset:{},listeners:{},
      setAttribute(){},addEventListener(event,fn){this.listeners[event]=fn;},focus(){}});
    return elements.get(id);
  };
  const presets=['10','100','1000'].map(value=>Object.assign(element('preset-'+value),{dataset:{donationAmount:value}}));
  const client={
    async requestPermissions(p){permissions.push(p);assert.deepEqual(p,{scopes:['operation_request'],networks:[{chainId:'tezos:NetXdQprcVkpaWU'}]});},
    async getActiveAccount(){return {address,network:{type:'mainnet',chainId:'tezos:NetXdQprcVkpaWU'},scopes:['operation_request']};},
    async disconnect(){},
    async requestOperation(p){operations.push(p);return {transactionHash:'o'+'a'.repeat(50)};}
  };
  const source=readFileSync(new URL('../src/wallet-ui.mjs',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace("import('./octez-client.mjs')",'loadClient()');
  runInNewContext(source,{
    document:{getElementById:element,querySelectorAll:()=>presets,addEventListener(){}},
    BAKER,buildDelegationRequest,networkState:createNetworkState(),
    createController:options=>(controller=createController({...options,loadState:async()=>({address,network:'mainnet',chainId:CHAIN,balance:'2000000000',staked:'0',unstakedFrozen:'0',delegate:null,observedAt:Date.now()})})),
    async loadClient(){loads++;return {makeClient:()=>client};}
  },{filename:'wallet-ui.mjs'});
  return {element,presets,operations,permissions,address,get loads(){return loads;},get model(){return controller?.model;},
    async fire(id,event='click'){
      const el=typeof id==='string'?element(id):id;
      await el.listeners[event]();
      for(let i=0;i<50;i++)await Promise.resolve();
    }
  };
}

test('actual UI/controller/cores: preset connect-only, canonical review, cancellation and one explicit fixed-recipient approval',async()=>{
  const h=integratedUI();assert.equal(h.loads,0);assert.equal(h.operations.length,0);
  await h.fire(h.presets[0]);
  assert.equal(h.element('donation-amount').value,'10');
  assert.equal(h.loads,1);assert.equal(h.permissions.length,1);
  assert.equal(h.model.account.address,h.address);assert.equal(h.model.donationReview,null);
  assert.equal(h.element('donation-consent').checked,false);
  assert.equal(h.element('donation-review').disabled,true);assert.equal(h.element('donation-confirm').disabled,true);
  for(const preset of h.presets){
    await h.fire(preset);assert.equal(h.element('donation-amount').value,preset.dataset.donationAmount);
    assert.equal(h.model.donationReview,null);assert.equal(h.operations.length,0);
  }
  assert.equal(h.loads,1);assert.equal(h.permissions.length,1);
  await h.fire('donation-review'); // Even a synthetic click cannot bypass consent.
  assert.equal(h.model.donationReview,null);assert.equal(h.operations.length,0);
  h.element('donation-amount').value='00010.100000';await h.fire('donation-amount','input');
  h.element('donation-consent').checked=true;await h.fire('donation-consent','change');
  await h.fire('donation-review');
  assert.equal(h.model.donationReview.amountMutez,'10100000');
  assert.equal(h.element('donation-review-amount').textContent,'10.1 XTZ');
  assert.equal(h.element('donation-review-source').textContent,h.address);
  assert.equal(h.element('donation-review-target').textContent,BAKER);
  assert.equal(h.element('donation-confirm').disabled,false);assert.equal(h.operations.length,0);
  h.element('donation-amount').value='100';await h.fire('donation-amount','input');
  assert.equal(h.model.donationReview,null);assert.equal(h.element('donation-confirm').disabled,true);
  await h.fire('donation-confirm');assert.equal(h.operations.length,0);
  await h.fire('donation-review');
  h.element('donation-consent').checked=false;await h.fire('donation-consent','change');
  assert.equal(h.model.donationReview,null);assert.equal(h.element('donation-summary').hidden,true);
  assert.equal(h.element('donation-confirm').disabled,true);
  await h.fire('donation-confirm');assert.equal(h.operations.length,0);
  h.element('donation-consent').checked=true;await h.fire('donation-consent','change');
  await h.fire('donation-review');assert.equal(h.operations.length,0);
  await h.fire('donation-confirm');
  assert.deepEqual(h.operations,[{operationDetails:[{kind:'transaction',source:h.address,destination:BAKER,amount:'100000000'}]}]);
  assert.equal(h.model.hash,'o'+'a'.repeat(50));assert.equal(h.model.donationReview,null);
  assert.equal(h.element('donation-confirm').disabled,true);
  await h.fire('donation-confirm');assert.equal(h.operations.length,1);
});
