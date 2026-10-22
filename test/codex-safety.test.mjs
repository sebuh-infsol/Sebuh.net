import test from 'node:test';
import assert from 'node:assert/strict';
import {createDonationsController} from '../src/donations-controller.mjs';
import {DONATIONS_CONFIG} from '../src/donations-config.mjs';
import {buildDonationOp,setToolkitOverride} from '../src/donations-taquito.mjs';
test('config alone blocks review and forged submission without a connected account; no wallet calls',async()=>{
 let calls=0; const c=createDonationsController({client:{requestOperation(){calls++;}}});
 assert.equal(DONATIONS_CONFIG.submissionPolicy,'verified-testnet');
 assert.throws(()=>c.review('', '1',true),/Connect/ );
 c.model.review={createdAt:Date.now()};
 await assert.rejects(c.submit(true),/getActiveAccount|Connect/);assert.equal(calls,0);
});
test('Number boundary accepts exact maximum and rejects next mutez before toolkit access',async()=>{
 let accesses=0;setToolkitOverride({rpc:{getChainId:async()=>DONATIONS_CONFIG.chainId},contract:{async at(){accesses++;return {methodsObject:{donate:()=>({toTransferParams:o=>({amount:o.amount,parameter:{value:{bytes:''}}})})}};}}});
 try {const op=await buildDonationOp({memo:'',amountMutez:String(Number.MAX_SAFE_INTEGER)});assert.equal(op.amount,String(Number.MAX_SAFE_INTEGER));
 await assert.rejects(buildDonationOp({memo:'',amountMutez:'9007199254740992'}),/safe integer/);assert.equal(accesses,1);
 }finally{setToolkitOverride(null);}
});
test('permission requests bind CAIP2 and reject same-name wrong-chain account',async()=>{
 let permission;const c=createDonationsController({client:{async requestPermissions(o){permission=o;},async getActiveAccount(){return {address:'tz1-fixture',network:{type:'shadownet',chainId:'tezos:NetXdQprcVkpaWU'},scopes:['operation_request']};}},loadState:async()=>{throw Error('must not read');}});
 await assert.rejects(c.connect(),/chain/);assert.equal(permission.networks[0].chainId,DONATIONS_CONFIG.caip2);assert.equal(c.model.account,null);
});
import {createController} from '../src/delegation-controller.mjs';
test('legacy wallet permission binds Mainnet CAIP2; wrong chain fails before balance load',async()=>{
 let permission;let reads=0;const c=createController({client:{async requestPermissions(p){permission=p;},async getActiveAccount(){return {address:'fixture',network:{type:'mainnet',chainId:DONATIONS_CONFIG.caip2},scopes:['operation_request']};}},loadState:async()=>{reads++;return {};}});
 await assert.rejects(c.connect(),/chain/);assert.equal(reads,0);assert.equal(permission.networks[0].chainId,'tezos:NetXdQprcVkpaWU');
});
