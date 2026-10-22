import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNetworkState} from '../src/network-state.mjs';
import {DONATIONS_NETWORKS,DEFAULT_DONATIONS_NETWORK} from '../src/donations-config.mjs';
function harness(file,networkState,extra={}){const els=new Map();const element=id=>{if(!els.has(id))els.set(id,{value:'',dataset:{},listeners:{},addEventListener(e,f){(this.listeners[e]??=[]).push(f);},setAttribute(){}});return els.get(id);};const sandbox={networkState,DONATIONS_NETWORKS,DEFAULT_DONATIONS_NETWORK,document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},...extra};const src=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');runInNewContext(src,sandbox);return {sandbox,element};}
test('real donation boot preflights app veto before global selection or listeners change',()=>{
 const n=createNetworkState('shadownet');const h=harness('donations-boot.mjs',n);runInNewContext('app={canSwitch:()=>"donation uncertain",setNetwork(){throw Error("must not commit")}}',h.sandbox);
 assert.throws(()=>n.select('mainnet'),/donation uncertain/);assert.equal(n.selected().network,'shadownet');assert.equal(n.epoch(),0);
});
test('real wallet registers independent uncertain veto',()=>{
 const n=createNetworkState();const h=harness('wallet-ui.mjs',n,{BAKER:'fixture',buildDelegationRequest(){},createController(){}});
 runInNewContext('controller={model:{uncertain:true}}',h.sandbox);
 assert.throws(()=>n.select('shadownet'),/uncertain/);assert.equal(n.selected().network,'mainnet');
});
test('wallet network change discards account balance and review without reconnecting',()=>{
 const n=createNetworkState();let disconnected=0;const h=harness('wallet-ui.mjs',n,{BAKER:'fixture',buildDelegationRequest(){},createController(){}});
 h.sandbox.old={model:{account:{address:'old'},state:{balance:'999'},review:{}},disconnect:async()=>{disconnected++;}};
 runInNewContext('controller=old',h.sandbox);n.select('shadownet');
 assert.equal(h.element('wallet-account').textContent,'Not connected');assert.equal(h.element('wallet-header-details').hidden,true);assert.equal(h.element('donation-review').disabled,true);assert.equal(h.element('delegation-review').disabled,true);assert.equal(disconnected,1);
});

test('unverified live storage UI disables signing controls and synthetic review/confirm clicks never invoke controller',()=>{
 let calls=0;const h=harness('donations-ui.mjs',createNetworkState('shadownet'),{createDonationsController(){calls++;throw Error('must not create');}});
 h.sandbox.initDonationsApp('shadownet');
 for(const id of ['donations-review','donations-confirm','donations-consent','donations-amount'])assert.equal(h.element(id).disabled,true);
 assert.match(h.element('donations-status').textContent,/verify.*beneficiary/);
 for (const id of ['donations-review','donations-confirm']) for (const fn of h.element(id).listeners.click) fn();assert.equal(calls,0);
});
