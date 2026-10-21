import {BAKER,CHAIN,RPC} from './delegation-core.mjs';

// Funding target from the restart plan, NOT a protocol eligibility threshold.
export const GOAL_MUTEZ='3800000000';
function amount(value){
  if(typeof value!=='string' || !/^\d{1,20}$/.test(value))throw new Error('Invalid public funding amount.');
  return BigInt(value);
}
function formatXTZ(value){
  const whole=(value/1000000n).toLocaleString('en-US');
  const fraction=(value%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
  return whole+(fraction?'.'+fraction:'');
}
export function calculateProgress({balance,ownStaked}){
  const liquid=amount(balance),staked=amount(ownStaked),goal=amount(GOAL_MUTEZ);
  const total=liquid+staked,remaining=total<goal?goal-total:0n;
  const basisPoints=Number(total>=goal?10000n:total*10000n/goal);
  return{currentXTZ:formatXTZ(total),goalXTZ:formatXTZ(goal),remainingXTZ:formatXTZ(remaining),liquidXTZ:formatXTZ(liquid),stakedXTZ:formatXTZ(staked),basisPoints,percent:(basisPoints/100).toFixed(2),goalReached:total>=goal};
}
export function createFundingController({load=readRestartState,onChange=()=>{}}={}){
  const model={snapshot:null,busy:false,error:null};
  let pending=null;
  function refresh(){
    if(pending)return pending;
    let finish;
    const result=new Promise(resolve=>{finish=resolve;});pending=result;
    model.busy=true;onChange(model);
    (async()=>{
      try{const next=await load();calculateProgress(next);model.snapshot=next;model.error=null;}
      catch{model.error='Public funding data could not be verified. No balance is assumed.';}
      finally{model.busy=false;pending=null;onChange(model);finish();}
    })();
    return result;
  }
  return{model,refresh};
}

export async function readRestartState({fetcher=globalThis.fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  async function get(path){
    for(let attempt=0;attempt<3;attempt++){
      await pause(attempt?1000*attempt:300);
      const response=await fetcher(RPC+path,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
      if(response.status===429)continue;
      if(!response.ok)throw new Error('Public mainnet RPC unavailable.');
      return response.json();
    }
    throw new Error('Public RPC rate limit reached.');
  }
  const chainId=await get('/chains/main/chain_id');
  if(chainId!==CHAIN)throw new Error('Funding RPC is not Tezos mainnet.');
  const block=await get('/chains/main/blocks/head/hash');
  if(typeof block!=='string' || !/^B[1-9A-HJ-NP-Za-km-z]{50}$/.test(block))throw new Error('Invalid funding block reference.');
  const base='/chains/main/blocks/'+block;
  const header=await get(base+'/header');
  const fresh=()=>{const age=Date.now()-Date.parse(header?.timestamp);if(!Number.isFinite(age)||age< -30000||age>120000)throw new Error('Public funding snapshot is stale or the device clock is incorrect.');};
  fresh();
  const balance=await get(base+'/context/contracts/'+BAKER+'/balance');
  const ownStaked=await get(base+'/context/delegates/'+BAKER+'/own_staked');
  amount(balance);amount(ownStaked);fresh();
  return{balance,ownStaked,block,timestamp:header.timestamp,chainId};
}
