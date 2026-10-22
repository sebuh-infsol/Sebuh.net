import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createNetworkState} from '../src/network-state.mjs';
import {createController} from '../src/delegation-controller.mjs';
import {buildDelegationRequest,BAKER,CHAIN} from '../src/delegation-core.mjs';

const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
function header(){
  let now=1000000,nextTimer=0;
  const elements=new Map(),timers=new Map(),events=new Map(),operations=[],intervals=[];
  let loads=0,hidden=false;
  const el=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,checked:false,value:id==='donation-amount'?'10':'',textContent:'',title:'',attributes:{},events:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,fn){this.events[name]=fn;},focus(){}});
    return elements.get(id);
  };
  let controller;
  class Clock extends Date {static now(){return now;}}
  let state={address,network:'mainnet',chainId:CHAIN,balance:'123456789',staked:'999999999999',unstakedFrozen:'555555555555',delegate:BAKER,observedAt:now,bakerDeactivated:true};
  const client={async requestPermissions(){},async getActiveAccount(){return{address,network:{type:'mainnet',chainId:'tezos:NetXdQprcVkpaWU'},scopes:['operation_request']};},async disconnect(){},async requestOperation(request){operations.push(request);throw Error('Non-signing fixture');}};
  const source=readFileSync(new URL('../src/wallet-ui.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace("import('./octez-client.mjs')",'loadClient()');
  runInNewContext(source,{document:{get hidden(){return hidden;},getElementById:el,querySelectorAll:()=>[],addEventListener(name,fn){events.set(name,fn);}},Date:Clock,BAKER,buildDelegationRequest,networkState:createNetworkState(),
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){intervals.push({fn,delay});},
    createController(options){controller=createController({...options,loadState:async()=>{loads++;return state;}});return controller;},async loadClient(){return{makeClient:()=>client};}
  });
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  return{el,operations,get loads(){return loads;},get controller(){return controller;},async click(id){el(id).events.click();await flush();},setState(value){state=value;},get state(){return state;},
    async minute(){now+=60000;state={...state,observedAt:now};for(const t of intervals)t.fn();await flush();},
    async visibility(value=false){hidden=value;events.get('visibilitychange')?.();await flush();},
    expire(){now+=120001;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}};
}

test('wallet details sit below controls inside top-right header and replace navigation links',()=>{
  const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  const top=html.match(/<div class="topnav"[\s\S]*?<\/header>/)?.[0] || '';
  assert.match(top,/<div class="header-wallet"/);
  assert.ok(top.indexOf('id="wallet-connect"')<top.indexOf('id="wallet-header-details"'));
  assert.match(top,/id="wallet-header-address"/);assert.match(top,/id="wallet-header-balance"/);
  const bar=top.slice(0,top.indexOf('<a class="wordmark"'));
  assert.doesNotMatch(bar,/<a\b/);
  assert.equal([...html.matchAll(/class="header-wallet"/g)].length,1);
});

test('actual UI shows exact first-six and last-six address and spendable-only balance after connecting',async()=>{
  const h=header();assert.equal(h.el('wallet-header-details').hidden,true);
  await h.click('wallet-connect');
  assert.equal(h.el('wallet-header-details').hidden,false);
  assert.equal(h.el('wallet-header-address').textContent,'tz1VSU…8Cjcjb');
  assert.equal(h.el('wallet-header-address').title,address);
  assert.equal(h.el('wallet-header-address').attributes['aria-label'],'Connected account '+address);
  assert.equal(h.el('wallet-header-balance').textContent,'Available: 123.456789 XTZ');
  assert.equal(h.operations.length,0);
  await h.click('wallet-disconnect');assert.equal(h.el('wallet-header-details').hidden,true);
});

test('header preserves integer-mutez precision including zero and one mutez, never counting stake',async()=>{
  for(const [balance,expected] of [['0','0'],['1','0.000001'],['10000000','10'],['99999999999999999999','99999999999999.999999']]){
    const h=header();h.setState({...h.state,balance});await h.click('wallet-connect');
    assert.equal(h.el('wallet-header-balance').textContent,'Available: '+expected+' XTZ');
  }
});

test('wallet balances never poll or refresh on tab visibility; explicit Refresh still reads',async()=>{
  const h=header();await h.minute();assert.equal(h.loads,0);
  await h.click('wallet-connect');assert.equal(h.loads,1);
  h.setState({...h.state,balance:'2000000'});await h.minute();
  await h.visibility(true);await h.visibility(false);
  assert.equal(h.loads,1,'time and tab return must not trigger account reads');
  await h.click('wallet-refresh');assert.equal(h.loads,2);
  assert.equal(h.el('wallet-header-balance').textContent,'Available: 2 XTZ');
  assert.equal(h.operations.length,0);
});

test('stale header keeps its last checked amount without pretending it is current',async()=>{
  const h=header();await h.click('wallet-connect');h.expire();
  assert.match(h.el('wallet-header-balance').textContent,/^Last checked: 123\.456789 XTZ/);
  assert.match(h.el('wallet-header-balance').textContent,/reload/i);
  assert.equal(h.loads,1);
  const x=header();await x.click('wallet-connect');x.controller.model.uncertain=true;
  x.controller.cancelReview();assert.doesNotMatch(x.el('wallet-header-balance').textContent,/123\.456789/);
});
