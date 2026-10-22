import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNetworkState} from '../src/network-state.mjs';
import {DONATIONS_NETWORKS,DEFAULT_DONATIONS_NETWORK} from '../src/donations-config.mjs';
import {createController} from '../src/delegation-controller.mjs';
import {createDonationsController} from '../src/donations-controller.mjs';
import {BAKER,buildDelegationRequest} from '../src/delegation-core.mjs';
const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function wiring(){
 const n=createNetworkState(),els=new Map(),events=new Map(),clients=[],permissions=[],ctls=[],operations=[];
 const el=id=>{if(!els.has(id))els.set(id,{value:'1',dataset:{},listeners:{},setAttribute(){},addEventListener(e,f){(this.listeners[e]??=[]).push(f);},appendChild(){},focus(){}});return els.get(id);};
 const h={n,el,clients,permissions,ctls,operations,wrong:false,imports:null,appImport:null,permission:null,disconnect:null,stateRead:null,balance:'1234567',reads:0};
 const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
 h.flush=flush;h.click=async id=>{for(const f of [...(el(id).listeners.click||[])])f();await flush();};
 const client=network=>{const c={network,disconnects:0,async requestPermissions(p){permissions.push(p);if(h.permission)await h.permission.promise;},async getActiveAccount(){return {address,network:{type:network,chainId:h.wrong?'tezos:wrong':DONATIONS_NETWORKS[network].caip2},scopes:['operation_request']};},async disconnect(){c.disconnects++;if(h.disconnect)await h.disconnect.promise;},async requestOperation(p){operations.push(p);throw Error('NO SIGNING');}};clients.push(c);return c;};
 const sandbox={networkState:n,DONATIONS_NETWORKS,DEFAULT_DONATIONS_NETWORK,BAKER,buildDelegationRequest,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>({}),addEventListener(e,f){(events.get(e)||events.set(e,[]).get(e)).push(f);}},
 createController(o){const c=createController({...o,loadState:async()=>{if(h.stateRead)await h.stateRead.promise;return {address,balance:h.balance,observedAt:Date.now(),delegate:BAKER};}});ctls.push(c);return c;},
 createDonationsController(o){const c=createDonationsController({...o,loadState:async()=>{h.reads++;return {totalDonatedMutez:'0',nextDonationId:0,donations:[]};},loadBalance:async()=>({address,balance:h.balance,observedAt:Date.now()})});ctls.push(c);return c;},
 loadClient:async()=>{if(h.imports)await h.imports.promise;return {makeClient:()=>client('mainnet'),makeDonationClient:cfg=>client(cfg.network)};},
 loadAppModule:async()=>{if(h.appImport)await h.appImport.promise;return {initDonationsApp:sandbox.initDonationsApp};}};
 for(const file of ['donations-ui.mjs','wallet-ui.mjs','donations-boot.mjs']){
 let src=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll("import('./octez-client.mjs')",'loadClient()').replaceAll("import('./donations-ui.js')",'loadAppModule()');
 if(file==='donations-ui.mjs')src+='\nglobalThis.initDonationsApp=initDonationsApp;';
 runInNewContext('{'+src+'}',sandbox);
 }
 h.visibility=()=>{for(const f of events.get('visibilitychange')||[])f();};return h;
}
test('B1 selected-network header pairs once with shared donation account and spendable balance',async()=>{
 const h=wiring();h.n.select('shadownet');assert.equal(h.el('wallet-connect').disabled,false);
 await Promise.all([h.click('wallet-connect'),h.click('donations-connect')]);
 assert.equal(h.clients.length,1);assert.equal(h.clients[0].network,'shadownet');assert.equal(h.permissions.length,1);
 assert.equal(h.permissions[0].networks[0].chainId,'tezos:NetXsqzbfFenSTS');
 assert.equal(h.el('donations-account').textContent,address);assert.equal(h.el('wallet-header-address').title,address);
 assert.equal(h.el('wallet-header-balance').textContent,'Available: 1.234567 XTZ');
 h.n.select('mainnet');await h.flush();assert.equal(h.clients[0].disconnects,1);assert.equal(h.el('wallet-header-details').hidden,true);
 await h.click('wallet-connect');assert.equal(h.clients.length,2);assert.equal(h.permissions[1].networks[0].chainId,'tezos:NetXdQprcVkpaWU');
});
test('B1 queued header pairing is abandoned after deferred app roundtrip',async()=>{
 const h=wiring();h.n.select('shadownet');h.appImport=deferred();await h.click('wallet-connect');h.n.select('mainnet');h.n.select('shadownet');h.appImport.resolve();await h.flush();assert.equal(h.clients.length,0);
 await h.click('wallet-connect');assert.equal(h.clients.length,1);
});
test('B1 pending pairing vetoes switch and wrong-chain permission is cleaned up',async()=>{
 const h=wiring();h.n.select('shadownet');h.permission=deferred();await h.click('wallet-connect');assert.throws(()=>h.n.select('mainnet'),/pending/);assert.equal(h.el('wallet-connect').textContent,'Waiting for wallet…');h.permission.resolve();await h.flush();
 for(const field of ['hash','uncertain']){h.ctls[0].model[field]=field==='hash'?'operation':true;assert.throws(()=>h.n.select('mainnet'),/pending|uncertain/);h.ctls[0].model[field]=null;}
 const x=wiring();x.wrong=true;x.n.select('shadownet');await x.click('wallet-connect');assert.equal(x.el('wallet-header-details').hidden,true);assert.equal(x.clients[0].disconnects,1);
});
test('M1 fixture allows safe refresh and disconnect while review and submit remain closed',async()=>{
 const h=wiring();h.n.select('shadownet');await h.click('donations-connect');
 assert.equal(h.el('donations-disconnect').disabled,false);assert.equal(h.el('donations-refresh').disabled,false);
 h.balance='9000000';await h.click('donations-refresh');assert.equal(h.reads,2);assert.equal(h.el('wallet-header-balance').textContent,'Available: 9 XTZ');
 await h.click('donations-review');await h.click('donations-confirm');assert.equal(h.ctls[0].model.review,null);assert.equal(h.operations.length,0);
 await h.click('donations-disconnect');assert.equal(h.clients[0].disconnects,1);assert.equal(h.el('wallet-header-details').hidden,true);
 await h.click('wallet-connect');await h.click('wallet-disconnect');assert.equal(h.clients.length,1);assert.equal(h.clients[0].disconnects,2);
});
test('L1 rejected Mainnet import cannot overwrite selected-network status after roundtrip',async()=>{
 const h=wiring();h.imports=deferred();await h.click('wallet-connect');h.n.select('shadownet');h.n.select('mainnet');h.n.select('shadownet');
 const before=h.el('wallet-status').textContent;h.imports.reject(Error('STALE MAINNET IMPORT'));await h.flush();assert.equal(h.el('wallet-status').textContent,before);assert.equal(h.clients.length,0);
});
test('L1 stale Mainnet controller status and balance cannot repaint switched header',async()=>{
 const h=wiring();await h.click('wallet-connect');const old=h.ctls[0];h.n.select('shadownet');await h.flush();await h.click('wallet-connect');
 old.model.account={address:'STALE'};old.model.state={address:'STALE',balance:'9999999',observedAt:Date.now()};old.model.error='STALE CALLBACK';old.cancelReview();h.visibility();
 assert.equal(h.el('wallet-header-address').title,address);assert.equal(h.el('wallet-header-balance').textContent,'Available: 1.234567 XTZ');assert.doesNotMatch(h.el('wallet-status').textContent,/STALE/);
});

test('M1 unresolved outcomes block synthetic pairing refresh and disconnect on both surfaces',async()=>{
 const h=wiring();h.n.select('shadownet');await h.click('wallet-connect');
 const c=h.ctls[0];c.model.account=null;c.model.uncertain=true;c.cancelReview();
 const reads=h.reads, prompts=h.permissions.length;
 for(const id of ['wallet-connect','donations-connect','wallet-refresh','donations-refresh','wallet-disconnect','donations-disconnect'])await h.click(id);
 assert.equal(h.permissions.length,prompts);assert.equal(h.reads,reads);assert.equal(h.clients[0].disconnects,0);assert.equal(c.model.uncertain,true);
});
test('B1 Mainnet wrong-chain pairing is torn down without donation client or balance',async()=>{
 const h=wiring();h.wrong=true;await h.click('wallet-connect');assert.equal(h.clients.length,1);assert.equal(h.clients[0].network,'mainnet');assert.equal(h.clients[0].disconnects,1);assert.equal(h.el('wallet-header-details').hidden,true);
});
test('L1 stale Mainnet successful client import after roundtrip never pairs',async()=>{
 const h=wiring();h.imports=deferred();await h.click('wallet-connect');h.n.select('shadownet');h.n.select('mainnet');h.imports.resolve();await h.flush();assert.equal(h.clients.length,0);await h.click('wallet-connect');assert.equal(h.clients.length,1);
});
test('L1 rejected deferred donation module cannot replace Mainnet donation status',async()=>{
 const h=wiring();h.n.select('shadownet');h.appImport=deferred();await h.click('wallet-connect');h.n.select('mainnet');const status=h.el('donations-status').textContent;
 h.appImport.reject(Error('STALE SHADOWNET MODULE'));await h.flush();assert.equal(h.el('donations-status').textContent,status);
});

test('L1 late Mainnet teardown callbacks cannot clear Shadownet account or balance',async()=>{
 const h=wiring();await h.click('wallet-connect');h.disconnect=deferred();h.n.select('shadownet');await h.click('wallet-connect');
 assert.equal(h.el('wallet-header-address').title,address);h.disconnect.resolve();await h.flush();h.visibility();
 assert.equal(h.el('wallet-header-address').title,address);assert.equal(h.el('wallet-header-balance').textContent,'Available: 1.234567 XTZ');
});
test('B1 Mainnet pending balance and permission reads veto network changes',async()=>{
 const h=wiring();h.stateRead=deferred();await h.click('wallet-connect');assert.throws(()=>h.n.select('shadownet'),/pending/);
 h.stateRead.resolve();await h.flush();assert.equal(h.el('wallet-header-balance').textContent,'Available: 1.234567 XTZ');
});
