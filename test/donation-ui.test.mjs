import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNetworkState} from '../src/network-state.mjs';
let lastNetworkState;

// Execute the actual UI. The SDK/controller boundary is an explicit non-signing
// fixture; there is no wallet, transport, permission store or network here.
function ui(){
  const elements=new Map(),calls=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,disabled:false,hidden:false,checked:false,value:id==='donation-amount'?'10':'',textContent:'',listeners:{},dataset:{},
      addEventListener(event,fn){this.listeners[event]=fn;},setAttribute(){},focus(){this.focused=true;}});
    return elements.get(id);
  };
  const presets=['10','100','1000'].map(value=>Object.assign(element('preset-'+value),{dataset:{donationAmount:value}}));
  const model={account:null,state:null,review:null,donationReview:null,busy:false,error:null,hash:null,uncertain:false};
  let changed,loads=0;
  const emit=()=>changed(model);
  const controller={model,
    async connect(){calls.push(['connect']);model.account={address:'tz1-fixture'};model.state={delegate:null};emit();},
    async refresh(){calls.push(['refresh']);model.review=null;model.donationReview=null;emit();},
    async disconnect(){calls.push(['disconnect']);model.account=null;model.state=null;model.review=null;model.donationReview=null;emit();},
    cancelReview(){calls.push(['cancel']);model.review=null;model.donationReview=null;emit();},
    review(){calls.push(['delegate-review']);},submit(){calls.push(['delegate-submit']);},
    reviewDonation(amount,acknowledged){calls.push(['donation-review',amount,acknowledged]);if(!acknowledged)throw Error('Acknowledge gift');model.donationReview={source:model.account.address,destination:'tz1-fixed-baker',amountXTZ:amount};emit();},
    submitDonation(acknowledged){calls.push(['donation-submit',acknowledged]);}
  };
  const source=readFileSync(new URL('../src/wallet-ui.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace("import('./octez-client.mjs')",'loadClient()');
  runInNewContext(source,{document:{getElementById:element,querySelectorAll:()=>presets},
    BAKER:'tz1-fixed-baker',buildDelegationRequest(){},networkState:lastNetworkState=createNetworkState(),createController(options){changed=options.onChange;return controller;},
    async loadClient(){loads++;return{makeClient:()=>({})};}
  },{filename:'wallet-ui.mjs'});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  return {element,presets,model,calls,emit,controller,get loads(){return loads;},async click(el){(typeof el==='string'?element(el):el).listeners.click();await flush();},async event(id,type){element(id).listeners[type]();await flush();}};
}

test('preset donation buttons prefill exact XTZ and connect only; never submit or auto-review',async()=>{
  const h=ui();assert.equal(h.loads,0);
  await h.click(h.presets[0]);assert.equal(h.element('donation-amount').value,'10');
  assert.equal(h.loads,1);assert.equal(h.calls.filter(([name])=>name==='connect').length,1);
  assert.ok(h.element('donation-consent').disabled===false);
  for(const preset of h.presets){await h.click(preset);assert.equal(h.element('donation-amount').value,preset.dataset.donationAmount);}
  assert.equal(h.calls.filter(([name])=>name==='connect').length,1);
  assert.equal(h.calls.filter(([name])=>name.includes('review')||name.includes('submit')).length,0);
  assert.equal(h.element('donation-confirm').disabled,true);
});

test('actual donation UI requires gift consent, review and a distinct final wallet approval',async()=>{
  const h=ui();await h.click(h.presets[1]);
  assert.equal(h.element('donation-review').disabled,true);
  h.element('donation-consent').checked=true;await h.event('donation-consent','change');
  assert.equal(h.element('donation-review').disabled,false);
  await h.click('donation-review');
  assert.ok(h.calls.some(call=>JSON.stringify(call)===JSON.stringify(['donation-review','100',true])));
  assert.equal(h.element('donation-summary').hidden,false);
  assert.equal(h.element('donation-review-amount').textContent,'100 XTZ');
  assert.equal(h.element('donation-review-target').textContent,'tz1-fixed-baker');
  assert.equal(h.calls.filter(([name])=>name==='donation-submit').length,0);
  await h.click('donation-confirm');
  assert.ok(h.calls.some(call=>JSON.stringify(call)===JSON.stringify(['donation-submit',true])));
});

test('editing amount or unchecking gift consent invalidates the displayed review',async()=>{
  for(const change of ['amount','consent']){
    const h=ui();await h.click(h.presets[0]);h.element('donation-consent').checked=true;
    await h.event('donation-consent','change');await h.click('donation-review');
    if(change==='amount'){h.element('donation-amount').value='1000';await h.event('donation-amount','input');}
    else {h.element('donation-consent').checked=false;await h.event('donation-consent','change');}
    assert.equal(h.model.donationReview,null);assert.equal(h.element('donation-summary').hidden,true);
    assert.equal(h.element('donation-confirm').disabled,true);
    assert.equal(h.calls.filter(([name])=>name.includes('submit')).length,0);
  }
});

test('shared busy, uncertain and submitted states block both donation controls and preset reconnect',async()=>{
  for(const flag of ['busy','uncertain','hash']){
    const h=ui();await h.click(h.presets[0]);h.model[flag]=flag==='hash'?'o-fixture':true;h.emit();
    assert.equal(h.element('donation-review').disabled,true);assert.equal(h.element('donation-confirm').disabled,true);
    assert.ok(h.presets.every(button=>button.disabled));
    assert.equal(h.element('delegation-review').disabled,true);
    const before=h.calls.length;await h.click(h.presets[2]);assert.equal(h.calls.length,before);
    assert.equal(h.element('donation-amount').value,'10');
  }
});

test('donation markup presents real accessible presets, an editable amount and distinct approval',()=>{
  const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  for(const amount of ['10','100','1000'])assert.match(html,new RegExp('<button[^>]+data-donation-amount="'+amount+'"[^>]*>'+amount+' XTZ</button>'));
  for(const id of ['donation-amount','donation-consent','donation-review','donation-confirm','donation-summary','donation-status'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/input[^>]+id="donation-amount"[^>]+inputmode="decimal"/);
  assert.doesNotMatch(html,/supports ordinary delegation only—not staking, transfers|does not connect your wallet or prepare a transfer/);
});
