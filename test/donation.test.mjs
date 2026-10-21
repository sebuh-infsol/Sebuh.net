import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../src/donation-core.mjs',import.meta.url);
async function core(){assert.ok(existsSync(url),'donation core is not implemented');return import(url);}
import {BAKER,CHAIN} from '../src/delegation-core.mjs';
const address='tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
test('strict decimal donation parser preserves exact mutez and rejects malformed or oversized values',async()=>{
  const {parseDonationAmount:parse}=await core();
  for(const [input,expected] of [['10','10000000'],['100','100000000'],['1000','1000000000'],['0.000001','1'],['1.234567','1234567'],['00010.100000','10100000'],['99999999999999.999999','99999999999999999999']])assert.equal(parse(input),expected);
  for(const input of ['', '0','0.000000','-1','+1','1e2','NaN','Infinity','1,000','1_000',' 1','1 ','1.',' .1','.1','1.0000001','100000000000000',null,1,{},'1\n'])assert.throws(()=>parse(input),String(input));
});

test('request is fixed liquid-only mainnet transfer and fails closed on consent, identity, freshness and schemas',async t=>{
  // Keep the +5001ms rejection deterministic even across a scheduler/clock tick.
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const {buildDonationRequest:build}=await core();
  assert.equal(typeof build,'function');
  const base=()=>({account:{address,network:{type:'mainnet'},scopes:['operation_request']},state:{address,network:'mainnet',chainId:CHAIN,balance:'10000001',staked:'99999999999999999999',unstakedFrozen:'8',delegate:BAKER,observedAt:Date.now()},amountXTZ:'10',acknowledged:true,reviewed:true});
  assert.deepEqual(build(base()),{operationDetails:[{kind:'transaction',source:address,destination:BAKER,amount:'10000000'}]});
  const changes=[x=>x.acknowledged=false,x=>x.reviewed=false,x=>x.account=null,x=>x.account.network.type='ghostnet',x=>x.state.chainId='bad',x=>x.state.network='ghostnet',x=>x.account.scopes=['operation_request','sign'],x=>x.account.scopes=[],x=>x.account.address=BAKER,x=>x.account.address='KT1bad',x=>x.state.address=BAKER,x=>x.state.observedAt=NaN,x=>x.state.observedAt=Date.now()-120001,x=>x.state.observedAt=Date.now()+5001,x=>x.state.balance='10000000',x=>x.state.balance='9999999'];
  for(const field of ['balance','staked','unstakedFrozen'])for(const value of [null,undefined,1,-1,'-1','1.0','1e6','1_000','', '1'.repeat(21)])changes.push(x=>x.state[field]=value);
  for(const change of changes){const x=base();change(x);assert.throws(()=>build(x));}
});
