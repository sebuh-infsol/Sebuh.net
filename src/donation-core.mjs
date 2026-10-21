import {BAKER,CHAIN} from './delegation-core.mjs';

export function buildDonationRequest({account,state,amountXTZ,acknowledged,reviewed}) {
  if(acknowledged!==true || reviewed!==true) throw new Error('Acknowledge this gift and review the donation first.');
  if(!account || account.network?.type!=='mainnet' || state?.network!=='mainnet' || state.chainId!==CHAIN) throw new Error('Connect a Tezos mainnet wallet.');
  if(!Array.isArray(account.scopes) || account.scopes.length!==1 || account.scopes[0]!=='operation_request') throw new Error('An operation-only wallet connection is required.');
  if(typeof account.address!=='string' || !/^tz[1-5][1-9A-HJ-NP-Za-km-z]{33}$/.test(account.address) || account.address!==state.address || account.address===BAKER) throw new Error('Account changed or is not eligible for donations.');
  if(!Number.isFinite(state.observedAt) || Date.now()-state.observedAt>120000 || state.observedAt>Date.now()+5000) throw new Error('Account information is stale. Refresh and review again.');
  for(const field of ['balance','staked','unstakedFrozen']) if(typeof state[field]!=='string' || !/^[0-9]{1,20}$/.test(state[field])) throw new Error('Invalid balance data. Refresh before continuing.');
  const amount=parseDonationAmount(amountXTZ);
  if(BigInt(amount)>=BigInt(state.balance)) throw new Error('Donation must leave a liquid balance for wallet-estimated network fees. Staked and frozen funds are not available.');
  return {operationDetails:[{kind:'transaction',source:account.address,destination:BAKER,amount}]};
}

export function parseDonationAmount(text) {
  if(typeof text!=='string' || !/^[0-9]+(?:\.[0-9]{1,6})?$/.test(text)) throw new Error('Enter a positive XTZ amount with at most six decimal places.');
  const [whole,fraction='']=text.split('.');
  const mutez=(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))).toString();
  if(mutez==='0' || mutez.length>20) throw new Error('Donation amount must be positive and at most 20 mutez digits.');
  return mutez;
}
