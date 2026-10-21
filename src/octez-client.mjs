import {DAppClient} from '@tezos-x/octez.connect-dapp';
import {NetworkType} from '@tezos-x/octez.connect-types';
import {RPC} from './delegation-core.mjs';
import {DONATIONS_CONFIG} from './donations-config.mjs';

export function makeClient() {
  return new DAppClient({name:'Sebuh.net',appUrl:location.origin,
    network:{type:NetworkType.MAINNET,rpcUrl:RPC},enableMetrics:false,disableWalletConnect:true});
}

// Separate, shadownet-scoped client for the contract donation app. Kept apart
// from makeClient() (mainnet delegation) so the two flows hold independent,
// network-correct wallet sessions. config.network is a NetworkType value
// ('shadownet'), matching the account.network.type the controller validates.
export function makeDonationClient(config = DONATIONS_CONFIG) {
  const appUrl = typeof location !== 'undefined' ? location.origin : (typeof globalThis !== 'undefined' && globalThis.location?.origin) || 'http://localhost';
  return new DAppClient({
    name: 'Sebuh.net donations',
    appUrl,
    network: { type: config.network, name: config.network, rpcUrl: config.rpcUrl, chainId: config.caip2 },
    enableMetrics: false,
    disableWalletConnect: true,
  });
}
