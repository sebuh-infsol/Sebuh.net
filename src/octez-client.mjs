import {DAppClient} from '@tezos-x/octez.connect-dapp';
import {NetworkType} from '@tezos-x/octez.connect-types';
import {RPC} from './delegation-core.mjs';

export function makeClient() {
  return new DAppClient({name:'Sebuh.net',appUrl:location.origin,
    network:{type:NetworkType.MAINNET,rpcUrl:RPC},enableMetrics:false,disableWalletConnect:true});
}
