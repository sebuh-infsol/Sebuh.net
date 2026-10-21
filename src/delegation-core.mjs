export const BAKER = 'tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP';
export const CHAIN = 'NetXdQprcVkpaWU';
export const RPC = 'https://rpc.tzkt.io/mainnet';

function amount(value) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('Invalid balance data. Refresh before continuing.');
  return BigInt(value);
}

export function buildDelegationRequest({account,state,acknowledged,reviewed}) {
  if (acknowledged !== true || reviewed !== true) throw new Error('Read and acknowledge the no-payout policy, then review this delegation.');
  if (!account || account.network?.type !== 'mainnet' || state?.network !== 'mainnet' || state.chainId !== CHAIN) throw new Error('Connect a Tezos mainnet wallet.');
  if (!Array.isArray(account.scopes) || account.scopes.length!==1 || account.scopes[0]!=='operation_request') throw new Error('An operation-only wallet connection is required. Reconnect without raw-signing permission.');
  if (!/^tz[1-5][1-9A-HJ-NP-Za-km-z]{33}$/.test(account.address) || account.address !== state.address || account.address === BAKER) throw new Error('Account changed or is not eligible for this visitor delegation flow. Reconnect and review.');
  if (!Number.isFinite(state.observedAt) || Date.now()-state.observedAt > 120000 || state.observedAt>Date.now()+5000) throw new Error('Account information is stale. Refresh and review again.');
  if (amount(state.staked)>0n || amount(state.unstakedFrozen)>0n) throw new Error('This account has staked or frozen unstaking funds. Manage delegation in your wallet so those funds are not affected unexpectedly.');
  if (state.delegate === BAKER) throw new Error('This account already delegates to Sebuh.net. No transaction is needed.');
  if (amount(state.balance)===0n) throw new Error('A funded spendable balance is required for network fees.');
  return {operationDetails:[{kind:'delegation',source:account.address,delegate:BAKER}]};
}

export async function readAccountState(address,{fetcher=globalThis.fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if (!/^tz[1-5][1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('Unsupported Tezos account address.');
  const get=async(path,{absent=false}={})=>{
    for(let attempt=0;attempt<3;attempt++) {
      await pause(attempt ? 1000*attempt : 300);
      const r=await fetcher(RPC+path,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
      if(r.status===429) continue; // retry bounded READS only; never retry a wallet operation
      if(absent && r.status===404) return null;
      if(!r.ok) throw new Error('Public mainnet RPC unavailable. No delegation request was sent.');
      return r.json();
    }
    throw new Error('Public RPC rate limit reached. Wait and refresh; no delegation request was sent.');
  };
  const chainId=await get('/chains/main/chain_id');
  if(chainId!==CHAIN) throw new Error('RPC is not Tezos mainnet.');
  const block=await get('/chains/main/blocks/head/hash');
  if(typeof block!=='string' || !/^B[1-9A-HJ-NP-Za-km-z]{50}$/.test(block)) throw new Error('Invalid block reference.');
  const base='/chains/main/blocks/'+block;
  const header=await get(base+'/header');
  const age=Date.now()-Date.parse(header.timestamp);
  if(!Number.isFinite(age) || age < -30000 || age > 120000) throw new Error('RPC head or device clock is not fresh. No request was sent.');
  const contract=base+'/context/contracts/'+address;
  const values=[];
  for(const [path,options] of [
    [contract+'/balance'],[contract+'/staked_balance'],[contract+'/unstaked_frozen_balance'],
    [contract+'/delegate',{absent:true}],[base+'/context/delegates/'+BAKER]
  ]) values.push(await get(path,options));
  const [balance,rawStaked,unstakedFrozen,delegate,baker]=values;
  // The RPC's optional stake is null for an undelegated, non-delegate account.
  // Normalize only that documented case; missing/malformed amounts still fail.
  const staked=rawStaked===null && delegate===null ? '0' : rawStaked;
  amount(balance);amount(staked);amount(unstakedFrozen);
  if(delegate!==null && (typeof delegate!=='string' || !/^tz[1-5][1-9A-HJ-NP-Za-km-z]{33}$/.test(delegate))) throw new Error('Invalid delegate information.');
  if(typeof baker.deactivated!=='boolean') throw new Error('Baker state could not be verified.');
  return {address,network:'mainnet',chainId,block,balance,staked,unstakedFrozen,delegate,
    bakerDeactivated:baker.deactivated,observedAt:Math.min(Date.now(),Date.parse(header.timestamp))};
}
