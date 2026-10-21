// Single source of truth for the contract-based donation app.
//
// The donations contract is currently deployed on the shadownet testnet, so the
// front-end targets shadownet. To later point the SAME UI at a mainnet
// deployment, edit only this object (network, chainId, caip2, rpcUrl,
// contractAddress) — no other code changes are required.
//
// This module is deliberately separate from the mainnet delegation flow
// (delegation-core.mjs), which stays mainnet-hardcoded and is untouched.
export const DONATIONS_CONFIG = {
  network: 'shadownet',
  chainId: 'NetXsqzbfFenSTS',
  // CAIP-2 id used to target this network for a wallet operation.
  caip2: 'tezos:NetXsqzbfFenSTS',
  // Browser-reachable RPC used for live contract reads and operation building.
  // The public shadownet endpoint tracks the canonical node; swap in any trusted
  // shadownet node URL here for lower latency.
  rpcUrl: 'https://rpc.shadownet.teztnets.com',
  // Authoritative local node, used only by node-side tooling
  // (scripts/verify-donations.mjs). It is never reachable from the browser.
  nodeRpcUrl: 'http://127.0.0.1:18732',
  // The shadownet deployment of contracts/donations.tz.
  contractAddress: 'KT1Sgiad8uYnDQqpbG2Cc6G8DuDRvDRD6zXU',
  // The contract entrypoint the "give" action calls.
  entrypoint: 'donate',
  mutezPerTez: 1_000_000,
};
